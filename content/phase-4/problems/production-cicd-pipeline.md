## Scenario

This is the phase capstone. You will build, from an empty GitHub repository, a small but real SaaS service and the complete automated path that takes every commit on `main` to production with zero user-visible downtime. When you are done, you should be able to merge a pull request, walk away, and know that if anything is wrong the pipeline stops it or tells you how to reverse it.

Suggested service: a **Subscription Billing API** (TypeScript, Fastify or Express, Postgres):

- `POST /quotes` - price a subscription (plan, seats, cycle, country, coupon) using the pricing logic from the Unit Assertions exercise.
- `POST /invoices` - persist an invoice from a quote, with a unique invoice number.
- `GET /invoices/:id` and `GET /customers/:id/invoices`.
- `/healthz`, `/readyz`, `/version`, `/metrics`.

You may substitute a different domain if it has comparable money logic and a database.

## Target architecture

```
 developer
    |  push branch, open PR
    v
 GitHub ---------------------------------------------------------------+
 | PR workflow (ci.yml)                                                |
 |   [format] [lint] [typecheck] [unit] [integration + pg service]     |
 |   [docker build (no push)]                                          |
 |   required checks --> branch protection on main                     |
 |                                                                     |
 | main workflow (release.yml)                                         |
 |   gates again --> build + push ghcr.io/<you>/billing:sha-xxxxxxx    |
 |   --> migrate (expand-only) --> deploy STAGING --> smoke            |
 |   --> [approval: production env] --> migrate --> deploy PROD        |
 |   --> verify /version + smoke --> done | rollback                   |
 +---------------------------------------------------------------------+
                         |                          |
                         v                          v
                  staging host                production host
            (Caddy + blue/green or rolling  (same mechanism, own secrets)
             on a VPS, or a PaaS)
```

## What to build

1. **The application** with domain logic covered by unit tests and repository/route code covered by integration tests against real Postgres.
2. **A production Dockerfile** (multi-stage, non-root, healthcheck, graceful shutdown, `APP_VERSION` build arg) and `.dockerignore`.
3. **`ci.yml`** on `pull_request`: format check, lint, typecheck, unit tests, integration tests with a Postgres service container, and a Docker build that does not push. Jobs run in parallel where possible; the Docker build depends on the gates.
4. **Branch protection** on `main` requiring the CI checks and a pull request.
5. **`release.yml`** on push to `main`: re-runs gates (or depends on them), builds and pushes an image tagged with the short git SHA to GHCR using `GITHUB_TOKEN`, deploys to staging, runs smoke tests, waits for approval on a `production` environment, deploys to production, verifies `/version` equals the new tag.
6. **Zero-downtime deployment** to a real target: a VPS with Docker and a reverse proxy using blue-green, or a PaaS (Fly.io, Render, Railway, ECS) with rolling deploys and readiness checks. Demonstrate it with a curl loop showing no failed requests during a deploy.
7. **Safe migrations**: a migration step that runs before the rollout, documented expand/contract policy, and at least one real expand/contract change carried out across multiple PRs in the repo history.
8. **Rollback**: a `workflow_dispatch` workflow (`rollback.yml`) that takes an image tag and redeploys it through the same deploy script.
9. **Observability**: structured JSON logs with version and request ID, a request-duration histogram, and a written list of what you check in the 30 minutes after a deploy.

## Constraints

- Production is deployed only from images built by the pipeline, never from a developer machine. The same image tag goes to staging and production.
- No long-lived secrets in the repo. Deploy credentials live in GitHub environment secrets scoped to `staging` and `production`.
- `concurrency` must prevent two production deploys running at once, and must never cancel an in-progress production deploy.
- PR feedback time under 10 minutes.
- A failing readiness check on the new version must leave the old version serving.

## How to verify

- Open a PR with a deliberate formatting error, then a type error, then a failing unit test. Each is caught by the expected job and merge is blocked.
- Merge a clean PR and record (screenshot or GIF) the full release run, including the approval step.
- While deploying, run `while true; do curl -s -o /dev/null -w "%{http_code}\n" https://<host>/healthz; sleep 0.2; done | sort | uniq -c` and show only 200s.
- Deploy a deliberately broken build (readiness returns 503). Show the pipeline failing and production still serving the previous version.
- Run `rollback.yml` with the previous tag and show `/version` changing back.
- Record the end-to-end time from merge to production for a typical change.
