## Why this matters

The classic small-team deploy: SSH into the server, `git pull`, `npm install`, `npm run build`, `pm2 restart`. For the 20-90 seconds that takes, customers get 502 errors, a webhook from Stripe fails and retries, and an in-flight invoice generation dies halfway. Sometimes `npm install` pulls a slightly different transitive dependency than you tested. Sometimes the migration runs, the new code fails to start, and the old code cannot read the new schema. Now you are debugging production at 23:00 with no way back.

Continuous delivery (CD) replaces that with a repeatable process: CI builds one immutable image, the pipeline pushes it to a registry, and a deploy step swaps running containers to the new image **without dropping traffic**, verifies health, and can return to the previous image in one command.

Terminology: *continuous delivery* means every commit on `main` is deployable and deploying is a push-button action. *Continuous deployment* means every green commit is deployed automatically. Both use the same machinery.

## The delivery flow

```
  push to main
      |
      v
  CI gates (lint, typecheck, unit, integration)
      |
      v
  docker build ---> tag: sha-3f9c2a1 ---> push to ghcr.io/acme/billing-api
      |
      v
  deploy to STAGING (same image) ---> smoke tests ---> health OK?
      |                                                   |
      |                                       no: stop, alert
      v
  approval gate (GitHub environment "production")
      |
      v
  deploy to PRODUCTION (same image, rolling/blue-green/canary)
      |
      v
  post-deploy verification (health, error rate, latency)
      |
      +-- bad --> rollback to previous sha tag
```

The single most important property: **the image deployed to production is byte-for-byte the image that passed tests and ran on staging.** You promote a tag; you never rebuild.

## Building and pushing to GHCR

GitHub Container Registry (`ghcr.io`) is free for public images and integrated with Actions. The workflow authenticates with the built-in `GITHUB_TOKEN`, so you do not manage registry passwords.

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    branches: [main]

permissions:
  contents: read
  packages: write

jobs:
  image:
    runs-on: ubuntu-latest
    outputs:
      tag: ${{ steps.vars.outputs.tag }}
      image: ${{ steps.vars.outputs.image }}
    steps:
      - uses: actions/checkout@v4

      - id: vars
        run: |
          echo "image=ghcr.io/${GITHUB_REPOSITORY,,}" >> "$GITHUB_OUTPUT"   # lowercase
          echo "tag=sha-${GITHUB_SHA::7}" >> "$GITHUB_OUTPUT"

      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            ${{ steps.vars.outputs.image }}:${{ steps.vars.outputs.tag }}
            ${{ steps.vars.outputs.image }}:main
          build-args: APP_VERSION=${{ steps.vars.outputs.tag }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

Notes:

- `ghcr.io` image names must be lowercase; `${GITHUB_REPOSITORY,,}` is bash for "lowercase this variable".
- `sha-${GITHUB_SHA::7}` produces an immutable tag like `sha-3f9c2a1`. (`docker/metadata-action` can generate tags and OCI labels for you too; computing the tag yourself keeps it obvious.) Deploy by this tag. A moving tag like `main` is convenient for humans but useless for rollbacks.
- `cache-from/to: type=gha` stores BuildKit layer cache in the Actions cache, so unchanged `npm ci` layers are not rebuilt.
- In a real pipeline this workflow either runs the CI gates itself or is triggered after CI succeeds (`workflow_run`, or `needs:` within one workflow). Never push a release image from unverified code.

## Environments and approval gates

GitHub **environments** (Settings > Environments) let you attach protection rules and scoped secrets to a deploy target.

```yaml
  deploy-staging:
    needs: image
    runs-on: ubuntu-latest
    environment:
      name: staging
      url: https://staging.billing.example.com
    steps:
      - run: ./scripts/deploy.sh staging "${{ needs.image.outputs.tag }}"
        env:
          DEPLOY_SSH_KEY: ${{ secrets.DEPLOY_SSH_KEY }}

  deploy-production:
    needs: [image, deploy-staging]
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://billing.example.com
    concurrency:
      group: deploy-production
      cancel-in-progress: false   # never cancel a deploy halfway
    steps:
      - run: ./scripts/deploy.sh production "${{ needs.image.outputs.tag }}"
        env:
          DEPLOY_SSH_KEY: ${{ secrets.DEPLOY_SSH_KEY }}
```

On the `production` environment configure: required reviewers (someone clicks "Approve"), deployment branch restriction to `main` only, and production-only secrets. The `concurrency` group ensures two deploys never run at once, and that a deploy in progress is not cancelled by a newer push.

## Deployment strategies

### Recreate (the thing to avoid)

Stop old, start new. Simple, and causes downtime equal to startup time. Acceptable only for internal tools where a short outage is fine.

### Rolling update

Replace instances one (or a few) at a time. Each new instance must pass its readiness check before the load balancer sends it traffic and before the next old instance is stopped.

```
  t0:  [v1] [v1] [v1]
  t1:  [v2] [v1] [v1]     v2 ready -> receives traffic
  t2:  [v2] [v2] [v1]
  t3:  [v2] [v2] [v2]
```

Default in Kubernetes, ECS, Docker Swarm and most PaaS products. Cost-efficient. Trade-off: during the rollout both versions serve traffic simultaneously, so **v1 and v2 must be compatible with the same database schema and with each other's messages.**

### Blue-green

Run a full copy of the new version (green) next to the old one (blue). Test green directly. Then switch the load balancer or reverse proxy to green in one step. Blue stays running for instant rollback.

```
                  +----------------+
   users -------> | load balancer  |
                  +----------------+
                     |          :
             (live)  v          : (idle, after switch: live)
               +---------+   +---------+
               |  BLUE   |   |  GREEN  |
               |   v1    |   |   v2    |
               +---------+   +---------+
                     \         /
                      Postgres (shared)
```

Pros: instant cutover and instant rollback; you can smoke-test green with production config before users see it. Cons: double capacity during the deploy; the database is still shared, so schema compatibility still matters.

### Canary

Route a small share of traffic (say 5%) to v2, watch error rate and latency, then increase (25%, 50%, 100%) or abort.

```
   users --> LB --95%--> v1 v1 v1
               \--5%---> v2
```

Pros: limits the blast radius of a bad release to a few percent of users. Cons: needs weighted routing and good metrics to make the promote/abort decision; more moving parts.

| Strategy | Downtime | Extra capacity | Rollback speed | Complexity | Good fit |
|---|---|---|---|---|---|
| Recreate | Yes | None | Slow (redeploy) | Lowest | Internal tools |
| Rolling | No | +1 instance | Medium (roll back) | Low | Most SaaS APIs |
| Blue-green | No | 2x during deploy | Instant (switch) | Medium | Single-host apps, strict cutover |
| Canary | No | Small | Fast (route 0%) | Highest | High-traffic, risky changes |

### Blue-green on a single VM with Docker and Caddy

You do not need Kubernetes for zero downtime. A small SaaS on one VM can do blue-green with two containers and a reverse proxy:

```bash
#!/usr/bin/env bash
# scripts/remote-deploy.sh <image-tag>  (runs on the server)
set -euo pipefail
TAG="$1"
IMAGE="ghcr.io/acme/billing-api:${TAG}"

ACTIVE=$(cat /srv/billing/active 2>/dev/null || echo blue)
if [ "$ACTIVE" = "blue" ]; then NEXT=green; PORT=3002; else NEXT=blue; PORT=3001; fi

docker pull "$IMAGE"
docker rm -f "billing-$NEXT" 2>/dev/null || true
docker run -d --name "billing-$NEXT" --restart unless-stopped \
  --env-file /srv/billing/.env -p "127.0.0.1:${PORT}:3000" "$IMAGE"

# Wait for readiness (max 60s)
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/readyz" >/dev/null; then READY=1; break; fi
  sleep 2
done
if [ "${READY:-0}" != "1" ]; then
  echo "new version failed readiness, keeping $ACTIVE"; docker logs --tail 100 "billing-$NEXT"
  docker rm -f "billing-$NEXT"; exit 1
fi

# Switch proxy upstream and reload without dropping connections
sed -i "s/127.0.0.1:[0-9]*/127.0.0.1:${PORT}/" /etc/caddy/Caddyfile
caddy reload --config /etc/caddy/Caddyfile

echo "$NEXT" > /srv/billing/active
echo "$TAG" >> /srv/billing/deploy-history

sleep 20                      # let in-flight requests on the old version finish
docker stop -t 30 "billing-$ACTIVE"   # SIGTERM -> graceful shutdown
```

If readiness fails, the old version keeps serving and the deploy job exits non-zero, which fails the GitHub Actions run and alerts you. Users never notice.

## Health checks drive the whole process

Every strategy depends on the platform being able to ask "is this instance ready?":

- **Readiness** (`/readyz`): can serve traffic now. Fails while warming up or when the DB is unreachable. Load balancers use it to add or remove instances.
- **Liveness** (`/healthz`): process is not wedged. Failing it gets the container restarted. Keep it dependency-free, or a Postgres blip restarts every instance at once.
- **Smoke test** after deploy: a scripted request through the public URL that exercises a real path, such as `GET /api/plans` returning the expected plan list.

The app must also **shut down gracefully** on SIGTERM: stop accepting new connections, finish in-flight requests, close the DB pool. Without that, every rollout cuts off requests no matter which strategy you pick.

## Database migrations without downtime: expand and contract

The hard part of zero-downtime deploys is never the containers. It is the schema. During any rolling or blue-green deploy, old and new code run at the same time against one database. A migration that breaks the old code causes an outage even though "the deploy" looks fine.

Example: rename `invoices.customer_id` to `invoices.account_id`. Doing it in one migration breaks every v1 instance still running the moment the migration commits.

Expand/contract splits it into backward-compatible steps, each its own deploy:

```
 Release 1 (EXPAND)   add column account_id (nullable)
                      code writes BOTH customer_id and account_id, reads customer_id
 Backfill             UPDATE invoices SET account_id = customer_id
                      WHERE account_id IS NULL  -- in batches of e.g. 5,000
 Release 2 (SWITCH)   code reads account_id, still writes both
 Release 3 (CONTRACT) code stops writing customer_id
 Release 4 (CLEANUP)  migration: add NOT NULL on account_id, drop customer_id
```

At every point, the currently running version and the next version both work against the schema. Any single release can be rolled back.

Rules of thumb for Postgres:

| Safe in one step | Needs expand/contract or care |
|---|---|
| Add a nullable column | Rename or drop a column or table |
| Add a column with a constant default (Postgres 11+) | Change a column type |
| Add a new table | Add `NOT NULL` to an existing column with data |
| `CREATE INDEX CONCURRENTLY` | Plain `CREATE INDEX` on a large table (locks writes) |
| Add a constraint `NOT VALID`, then `VALIDATE CONSTRAINT` | Add a foreign key or check constraint validated in one go |

Also set `lock_timeout` in migrations (for example `SET lock_timeout = '5s'`) so a migration that cannot get its lock fails fast instead of queueing behind a long transaction and blocking all traffic.

**When to run migrations:** as a separate pipeline step **before** rolling out the new code, using the new image (`docker run --rm $IMAGE npm run db:migrate`). Because migrations are always expand-only at that point, the old code keeps working. Do not run migrations in the app's startup path when you have several instances; they will race.

## Rollbacks

A rollback is just a deploy of the previous known-good tag:

```bash
PREV=$(tail -n 2 /srv/billing/deploy-history | head -n 1)
./scripts/remote-deploy.sh "$PREV"
```

Or, in GitHub Actions, a `workflow_dispatch` workflow that takes a tag as input and runs the same deploy job. Requirements for rollbacks to work:

- Immutable image tags (git SHA), retained in the registry for a while.
- Schema compatible with the previous version, which expand/contract guarantees.
- Roll **forward** for data fixes: you cannot un-send emails or un-charge cards by redeploying old code.

Practise a rollback on staging before you need one in production. A rollback procedure that has never been run is a hypothesis.

## Common mistakes

- **Rebuilding the image per environment.** Staging and production then run different bytes.
- **Deploying `:latest`.** You cannot tell what is running or roll back to a specific version.
- **Destructive migrations in the same release as the code change.** The old version breaks mid-rollout.
- **No readiness check, or readiness that always returns 200.** Traffic goes to instances that cannot serve it.
- **Liveness checks that hit the database.** A DB hiccup restarts the whole fleet.
- **Ignoring SIGTERM.** In-flight requests are cut off during every deploy.
- **Running migrations on app startup across multiple instances.** Races and partial migrations.
- **Cancelling a production deploy mid-flight** because a newer commit arrived.

## In the real world

Most SaaS teams run rolling deploys on a platform (ECS, Kubernetes, Fly.io, Render, Railway) with readiness checks, plus expand/contract migrations as a team convention enforced in code review. Tools such as `strong_migrations` (Rails) or `squawk` (a Postgres migration linter) flag dangerous statements in CI. Canary releases are common at larger scale, often combined with feature flags so risky features ship dark and get enabled for a subset of tenants first, which is effectively a canary at the feature level instead of the deploy level.

The DORA metrics (deployment frequency, lead time for changes, change failure rate, time to restore) are the common way to measure this. Teams with fast, safe pipelines deploy many times per day with lower failure rates, because each change is small and each rollback is boring.

## Try it

1. Add the `release.yml` workflow to a repo. Push to `main` and confirm an image tagged `sha-<short>` appears under the repo's Packages.
2. Create `staging` and `production` environments in GitHub; require a reviewer for production.
3. On a cheap VM (or a local VM), set up Caddy and the blue-green script. Deploy twice while running `while true; do curl -s -o /dev/null -w "%{http_code}\n" https://your-host/healthz; sleep 0.2; done`. Confirm no non-200 responses.
4. Deploy an image whose `/readyz` always returns 503. Confirm the script refuses to switch and the old version keeps serving.
5. Write a three-release expand/contract plan for renaming `invoices.total` to `invoices.total_cents`.
