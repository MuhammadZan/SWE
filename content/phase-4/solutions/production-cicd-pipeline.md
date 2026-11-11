## What a strong solution looks like

A strong capstone is a small application with a pipeline you could hand to a team. The billing API is modest (quotes, invoices, a few reads) but well tested: pricing logic at the unit level, repositories and routes against a real Postgres. `ci.yml` runs the gates in parallel in under 10 minutes and they are required on `main`. `release.yml` builds one SHA-tagged image, migrates, deploys to staging, smoke-tests, waits for approval, deploys the same tag to production, and proves it with `/version`. `rollback.yml` reuses the same deploy script.

What separates strong from acceptable is evidence. The README contains the curl-loop output during a deploy (only 200s), the log of a deliberately broken release that failed readiness while production kept serving the old version, a rollback run link, and links to the PRs that carried out an expand/contract change. Every job can be explained in one sentence, and nothing in the pipeline exists only because a blog post had it.

## Reference approach

### Workflow layout

```
 ci.yml (pull_request, push to main)       permissions: contents: read
   quality (format, lint, typecheck) | unit | integration (pg 16 service)
   docker-build (needs all three, no push)
 release.yml (push to main)
   gates (reusable ci via workflow_call) -> image -> staging -> production
 rollback.yml (workflow_dispatch, input: tag, environment: production)
 scripts/deploy.sh <env> <tag>   shared by release and rollback
```

Calling `ci.yml` from `release.yml` (`on: workflow_call`) means the gates are defined once and an image is never pushed from untested code.

### Release workflow, essential parts

```yaml
permissions:
  contents: read
  packages: write

jobs:
  gates:
    uses: ./.github/workflows/ci.yml

  image:
    needs: gates
    runs-on: ubuntu-latest
    outputs:
      tag: ${{ steps.vars.outputs.tag }}
    steps:
      - uses: actions/checkout@v7
      - id: vars
        run: echo "tag=sha-${GITHUB_SHA::7}" >> "$GITHUB_OUTPUT"
      - uses: docker/setup-buildx-action@v4
      - uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v7
        with:
          push: true
          tags: ghcr.io/${{ github.repository }}:${{ steps.vars.outputs.tag }}
          build-args: APP_VERSION=${{ steps.vars.outputs.tag }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  production:
    needs: [image, staging]
    runs-on: ubuntu-latest
    environment: production
    concurrency:
      group: deploy-production
      cancel-in-progress: false
    steps:
      - uses: actions/checkout@v7
      - run: ./scripts/deploy.sh production "$TAG"
        env:
          TAG: ${{ needs.image.outputs.tag }}
          DEPLOY_SSH_KEY: ${{ secrets.DEPLOY_SSH_KEY }}
```

(If the repository owner name contains uppercase letters, lowercase the image name as shown in the CD lesson; GHCR rejects uppercase.) The `staging` job is identical with `environment: staging` and its own concurrency group.

### Deploy script contract

`deploy.sh <env> <tag>` does, in order: run migrations with the new image (`docker run --rm --env-file ... $IMAGE node dist/migrate.js`), start the new container on the idle port, poll `/readyz` for up to 60 seconds, exit non-zero and remove the new container if it never becomes ready, switch Caddy upstream and `caddy reload`, record the tag in a history file, wait for draining, `docker stop -t 30` the old container. Then, from the runner, poll the public `/version` until it equals the tag (timeout about 60 seconds) and run the smoke script. Because release and rollback call the same script, a rollback is exercised every time you deploy.

### Expand/contract in the history

For `invoices.currency`:

1. PR 1: migration adds `currency text` (nullable); code writes it on every new invoice and still works when it is null.
2. Backfill: a one-off, batched job (`UPDATE ... WHERE id IN (SELECT id ... WHERE currency IS NULL LIMIT 5000)`) run until zero rows remain.
3. PR 2: migration adds `CHECK (currency IS NOT NULL) NOT VALID`, validates it, then `SET NOT NULL`; code reads `currency` unconditionally.
4. PR 3: remove the fallback code path.

Each PR deploys independently and each could be rolled back to the previous image without errors.

### Observability

pino with `base: { version: process.env.APP_VERSION }`, a request-ID hook that accepts `x-request-id` or generates one, a `http_request_duration_seconds` histogram labelled by route template, and an `invoices_created_total` counter. The README lists the 30-minute post-deploy checks.

### Tests that matter

- Unit: the pricing table from the Unit Assertions exercise, unchanged.
- Integration: invoice number uniqueness (`23505`), `GET /customers/:id/invoices` returns only that customer's rows, `POST /invoices` with an invalid quote returns 400 and writes nothing.
- Pipeline: a smoke script hitting `/version`, `/readyz` and `POST /quotes` with a known answer.

### Numbers to aim for

PR feedback 4-8 minutes (quality about 1 min, unit under 1 min, integration 2-3 min, Docker build with cache 1-2 min). Merge to production 10-20 minutes including approval wait. Rollback under 5 minutes.

## Common mistakes

- **Building the image again in the production job.** The tested bytes and the deployed bytes differ.
- **Pushing from `ci.yml` on pull requests.** Untrusted code ends up in the registry, and fork PRs fail because they lack `packages: write`.
- **`cancel-in-progress: true` on deploy jobs.** A newer push kills a deploy halfway, leaving Caddy pointing at a container that is being removed.
- **Repository-level deploy secrets.** Any workflow, including one modified in a PR branch, can read them. Put them in the `staging` and `production` environments, and restrict production to `main`.
- **Readiness that always returns 200.** The broken-release demonstration then "passes", which is the point of doing it.
- **Migrations inside the app's startup.** They run before readiness, race across instances, and cannot be gated.
- **A rollback workflow that has never been run.** Its first execution should not be during an incident.
- **No evidence.** Claims of zero downtime without curl-loop output cannot be checked by anyone, including you a month later.

## Trade-offs worth discussing

- **VPS with Caddy blue-green versus a PaaS.** The VPS teaches every mechanism and is cheap, but you own patching, backups and TLS. A PaaS gives rolling deploys and health checks for free and hides the mechanics an interviewer may ask about.
- **Migrations before rollout versus as a separate approved job.** Before rollout is simple and safe for expand-only changes; contract migrations deserve their own manually triggered workflow.
- **Re-running gates on `main` versus trusting PR checks.** Re-running costs minutes but catches semantic merge conflicts between two individually green PRs; a merge queue is the scalable answer.
- **SSH keys versus OIDC.** An environment-scoped SSH key is acceptable for a VPS; for cloud platforms, OIDC short-lived credentials remove the long-lived secret entirely.
- **Approval gate versus automatic promotion.** A human click is a cheap safety net for a solo project; at higher deploy frequency, automated canary analysis replaces it.

## Grade yourself

| Dimension | Strong | Acceptable | Needs work |
|---|---|---|---|
| PR gate | Format, lint, typecheck, unit, integration and Docker build are required checks; deliberate failures each blocked by the expected job; under 10 min | All gates run, one not required or feedback over 10 min | Checks advisory, or a gate missing |
| Build once, promote | One SHA-tagged image per commit, same tag in staging and production, `/version` asserted after each deploy | Same tag used, version not verified | Rebuild per environment or `:latest` deploys |
| Zero downtime and failure safety | Curl loop shows only 200s; broken-readiness release fails the job with production still serving the old version, both evidenced | Zero downtime shown, failure case not demonstrated | Restart-based deploy with visible errors |
| Secrets and environments | Environment-scoped secrets, production restricted to `main` with a reviewer, no secrets in PR workflows, least-privilege `permissions` | Environments used, permissions left at defaults | Secrets at repository level or in the repo |
| Migrations | Pre-rollout migration step, written policy, a real multi-PR expand/contract change linked in MIGRATIONS.md | Policy written, change done in a single PR | Destructive migration shipped with the code change |
| Rollback and observability | `rollback.yml` run and linked, same script as release; JSON logs with version and request ID, histogram and business counter exposed | Rollback exists but untested, or metrics without business signal | No rollback path, or `console.log` only |

## Going further

- Add a canary step that sends a share of traffic to the new container and compares its 5xx rate with the old one before promoting.
- Sign images with cosign, attach an SBOM, and verify the signature in `deploy.sh` before starting the container.
- Replace the deploy SSH key with OIDC-issued short-lived credentials on a cloud platform, and document the trust policy that limits it to the `production` environment on `main`.
