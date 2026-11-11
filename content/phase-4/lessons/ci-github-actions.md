## Why this matters

You have tests now. The problem is that they only run when someone remembers to run them. A teammate merges a pull request on Friday afternoon, skipped the tests "because it was a one-line change", and the tax calculation is broken for the weekend. Or the tests pass on their machine because they have a stale local database, and fail for everyone else.

Continuous integration (CI) makes verification non-optional and identical for everyone. Every push and every pull request triggers the same checks in a clean environment, and the merge button stays disabled until they pass. The goal is simple: **`main` is always releasable.**

## The anatomy of a GitHub Actions workflow

Workflows are YAML files in `.github/workflows/`. The hierarchy:

```
  Workflow (.github/workflows/ci.yml)
    triggered by events: push, pull_request, schedule, workflow_dispatch
    |
    +-- Job: lint        (runs on its own fresh VM)
    |     +-- step: checkout
    |     +-- step: setup-node
    |     +-- step: npm ci
    |     +-- step: npm run lint
    |
    +-- Job: test        (parallel with lint by default)
    |     +-- steps...
    |
    +-- Job: build       (needs: [lint, test]  -> waits for both)
          +-- steps...
```

- **Workflow**: one YAML file, triggered by one or more events.
- **Job**: a set of steps that run on one runner (a fresh VM, for example `ubuntu-latest`). Jobs run in parallel unless you declare `needs`.
- **Step**: either a shell command (`run:`) or a reusable action (`uses:`). Steps in a job share the filesystem.
- **Action**: a packaged step, such as `actions/checkout@v4` or `actions/setup-node@v4`.

Jobs do not share files. If job B needs output from job A, pass it via artifacts (`actions/upload-artifact` / `download-artifact`), job outputs, or a registry.

## A first real CI workflow

```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
  push:
    branches: [main]

# Cancel superseded runs on the same branch/PR to save minutes
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  quality:
    name: Lint, format, typecheck
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npx prettier --check .
      - run: npx tsc --noEmit

  unit:
    name: Unit tests
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npx vitest run --coverage
```

Details that matter:

- `on.pull_request` runs on PRs; `on.push` to `main` re-verifies after merge.
- `concurrency` with `cancel-in-progress` stops wasting runner minutes when you push three commits in a row.
- `permissions: contents: read` gives the automatic `GITHUB_TOKEN` least privilege. The default can be broader depending on repo settings; set it explicitly.
- `timeout-minutes` prevents a hung test from burning 6 hours of minutes.
- `node-version-file: .nvmrc` keeps CI on the same Node version as local development.

## The quality gates

Each gate catches a different class of problem, cheaply, before a human reviewer spends time:

| Gate | Command | Catches | Typical time |
|---|---|---|---|
| Format | `prettier --check .` | Noise diffs, style debates | Seconds |
| Lint | `eslint .` | Unused vars, floating promises, unsafe patterns | Seconds |
| Typecheck | `tsc --noEmit` | Type errors that bundlers like esbuild/SWC skip | 10-60 s |
| Unit tests | `vitest run` | Logic regressions | Seconds to a minute |
| Integration tests | `vitest run -c vitest.integration.config.ts` | SQL, migrations, HTTP wiring | 1-5 min |
| Build | `npm run build` / `docker build` | Build breaks, missing files | 1-3 min |

Note the typecheck: many build tools strip types without checking them. Your app can build and deploy with type errors unless `tsc --noEmit` is a gate.

Use `--check` modes in CI, never auto-fix. CI should report, not silently change code.

## Caching dependencies

Without caching, every job downloads every npm package. `actions/setup-node` with `cache: npm` caches the npm download cache (`~/.npm`), keyed on the hash of `package-lock.json`. `npm ci` still runs, but pulls from the local cache.

For other caches, use `actions/cache` directly:

```yaml
- uses: actions/cache@v4
  with:
    path: .eslintcache
    key: eslint-${{ runner.os }}-${{ hashFiles('package-lock.json', 'eslint.config.*') }}
    restore-keys: |
      eslint-${{ runner.os }}-
```

The **key** must change when the inputs change. `restore-keys` allows a partial match so a stale cache is still used as a starting point. Never cache `node_modules` keyed on something other than the lockfile; you will get ghost packages.

For Docker builds, the BuildKit GitHub Actions cache backend reuses layers between runs (shown in the CD lesson).

## Matrix builds

A matrix runs the same job across combinations. Useful when you support multiple Node versions or want to shard a large test suite:

```yaml
  unit:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        node: [20, 22]
        shard: [1, 2, 3]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: npm
      - run: npm ci
      - run: npx vitest run --shard=${{ matrix.shard }}/3
```

That creates 6 jobs. `fail-fast: false` lets all combinations finish so you see whether a failure is version-specific. For a SaaS app deployed on one Node version, a matrix across Node versions is usually unnecessary; sharding is the more common use.

## Service containers for the database

Integration tests need Postgres. GitHub Actions can start containers alongside a job:

```yaml
  integration:
    name: Integration tests
    runs-on: ubuntu-latest
    timeout-minutes: 15
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: app
          POSTGRES_PASSWORD: app
          POSTGRES_DB: app_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U app -d app_test"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    env:
      DATABASE_URL: postgres://app:app@localhost:5432/app_test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run db:migrate
      - run: npm run test:int
```

The runner waits until the health command passes before starting steps. Because the job runs directly on the VM (not inside a container), it reaches Postgres at `localhost:5432` via the mapped port. If you set `container:` on the job to run steps inside a container, you would use the service name `postgres` as the host instead.

The password here is a throwaway for an ephemeral CI database; it is fine in plain text. Real credentials never are.

Testcontainers also works on `ubuntu-latest` runners because Docker is preinstalled; choose one approach and use it consistently in local and CI.

## Secrets and variables

- **Secrets** (Settings > Secrets and variables > Actions) are encrypted and masked in logs: `${{ secrets.STRIPE_TEST_KEY }}`.
- **Variables** are for non-sensitive config: `${{ vars.SENTRY_ORG }}`.
- **Environment secrets** are scoped to a deployment environment such as `production`, and can require approval before a job can read them.

```yaml
    steps:
      - run: npm run test:contract
        env:
          STRIPE_TEST_KEY: ${{ secrets.STRIPE_TEST_KEY }}
```

Rules:

- Secrets are **not** passed to workflows triggered by pull requests from forks. Design public-repo CI so the core gates need no secrets.
- Never `echo` a secret or write it to a file that is uploaded as an artifact. Masking only catches exact matches; a base64 version of the secret is not masked.
- Prefer OIDC (`permissions: id-token: write`) to long-lived cloud keys where your cloud provider supports it. The workflow exchanges a short-lived token for temporary credentials.
- Pin third-party actions to a full commit SHA when they get access to secrets. A tag like `@v3` can be moved by the action's owner.

## Required checks and branch protection

CI that can be ignored is a suggestion. Make it mandatory:

1. Settings > Branches (or Rules > Rulesets) > add a rule for `main`.
2. Require a pull request before merging, with at least one approval.
3. Require status checks to pass, and select the job names: `Lint, format, typecheck`, `Unit tests`, `Integration tests`.
4. Require branches to be up to date before merging (or use a merge queue).
5. Block force pushes and deletions.

```
   feature branch --push--> PR opened
                              |
                     CI: quality | unit | integration
                              |
                 all green + 1 review approved?
                     |                     |
                    no                    yes
                     |                     |
                merge blocked        merge to main --> CD workflow
```

The name you select is the job's `name:` (or its id if no name). If you rename a job, update the rule, or the PR waits forever for a check that will never report.

## Putting the jobs in order

A good pipeline fails fast and cheap:

```yaml
  build:
    name: Build image
    needs: [quality, unit, integration]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t billing-api:ci .
```

Lint, unit and integration run in parallel; the expensive Docker build only runs if all three pass. On a pull request you build to verify the Dockerfile works; on `main` you build and push (next lesson).

Keep total PR feedback time under about 10 minutes. Past that, developers stop waiting for it and start context switching, and CI becomes something people merge around.

## Reusable pieces

When several workflows repeat the same setup, extract a composite action:

```yaml
# .github/actions/setup/action.yml
name: Setup
description: Install Node from .nvmrc and project dependencies
runs:
  using: composite
  steps:
    - uses: actions/setup-node@v4
      with:
        node-version-file: .nvmrc
        cache: npm
    - run: npm ci
      shell: bash
```

```yaml
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup
      - run: npm run lint
```

## Common mistakes

- **Running only on `push` to main.** Problems are found after merge. Run on `pull_request`.
- **No branch protection.** Red CI with a green merge button.
- **`npm install` instead of `npm ci`.** CI silently uses different versions than the lockfile.
- **Fixing format in CI** (`prettier --write`) instead of checking. The fix is lost and the check never fails.
- **Skipping `tsc --noEmit`** because the build "already compiles".
- **Starting tests before Postgres is ready.** Use service health options.
- **Overly broad `GITHUB_TOKEN` permissions** and unpinned third-party actions with secret access.
- **Flaky tests left in place.** One flaky test teaches the team to click "re-run" instead of reading failures. Quarantine and fix it.

## In the real world

Most product teams settle on a CI workflow like the one above: three or four parallel jobs on pull requests, required checks on `main`, a merge queue once the team grows past a handful of engineers so that two individually-green PRs cannot combine into a broken `main`. Dependabot or Renovate opens PRs for dependency updates, and CI is what makes merging them safe.

Teams track CI duration as a real metric. When it creeps past 10-15 minutes, they shard tests, cache more aggressively, move slow end-to-end tests to a post-merge or nightly workflow, and use path filters so a docs-only change does not run the full suite.

## Try it

1. Add `.nvmrc`, and scripts for `lint`, `format:check`, `typecheck`, `test`, `test:int`, `db:migrate` to `package.json`.
2. Create `.github/workflows/ci.yml` with `quality`, `unit`, and `integration` (with a Postgres service) jobs and a `build` job that `needs` all three.
3. Open a PR that introduces a type error. Confirm only the typecheck step fails and its log points to the line.
4. Turn on branch protection for `main` requiring the three checks. Confirm the merge button is blocked on red.
5. Push three commits quickly and confirm older runs are cancelled by `concurrency`.
6. Add the workflow status badge to your README.
