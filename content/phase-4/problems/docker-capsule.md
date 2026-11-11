## Scenario

One of your mini SaaS apps (an invoicing API, a booking backend, a small ERP module) is deployed by SSHing into a VPS and running `git pull && npm install && npm run build && pm2 restart`. The server has Node installed by hand, a global TypeScript, and a `.env` file that someone edited in place. A new developer cannot run the app without a two-hour setup call.

Your job: package the app as a production-grade Docker image that runs identically anywhere with nothing but Docker installed, and prove it.

## Starting point

Use an existing Node/TypeScript backend with a Postgres dependency. If you do not have one handy, create a minimal Fastify or Express API with:

- `GET /healthz` returning `{ "status": "ok" }`
- `GET /readyz` running `select 1` against Postgres, 503 on failure
- `GET /invoices` returning rows from an `invoices` table
- a `build` script compiling TypeScript to `dist/`
- a migration script (`npm run db:migrate`, compiled to `dist/migrate.js` so the runtime image can run it with plain `node`)

A typical unoptimised starting Dockerfile you should improve on:

```dockerfile
FROM node:latest
WORKDIR /app
COPY . .
RUN npm install
RUN npm run build
CMD npm start
```

Build it once and write down the image size and the time for a rebuild after changing one source file. You will compare against these numbers.

## What to build

1. A **multi-stage `Dockerfile`**: a build stage with dev dependencies that compiles TypeScript, a production-dependencies stage, and a minimal runtime stage that contains only `dist/`, production `node_modules`, and `package.json`.
2. A **`.dockerignore`** that excludes `node_modules`, `.git`, `.env*`, test output and other noise.
3. **Non-root** execution and **exec-form** `CMD` so Node receives SIGTERM.
4. **Graceful shutdown**: on SIGTERM the app stops accepting connections, completes in-flight requests, closes the DB pool and exits within a few seconds.
5. A **`HEALTHCHECK`** in the Dockerfile hitting `/healthz`.
6. **Startup config validation** (zod or similar) so a missing `DATABASE_URL` fails immediately with a clear message.
7. A **`compose.yaml`** for local development with the app and Postgres, where the app waits for Postgres to be healthy.
8. A **"Running with raw Docker" section in README.md** with the exact raw `docker` commands (not compose) to build, create a network, start Postgres, run migrations, start the app, and test it.

## Constraints

- Base image pinned to a specific major version (for example `node:24-alpine`), never `latest`.
- No secrets in the image: no `.env` copied, no `ENV` or `ARG` containing credentials. Verify with `docker history --no-trunc`.
- Final image under 250 MB for a typical API (state yours in the README with the before/after numbers).
- Changing only a `.ts` file must not re-run the dependency install layer.
- The raw `docker run` path must work on a machine with **only Docker installed**: no host Node, no host Postgres.

## Raw docker commands you should be able to run

```bash
docker network create capsule
docker run -d --name capsule-db --network capsule \
  -e POSTGRES_USER=app -e POSTGRES_PASSWORD=app -e POSTGRES_DB=app postgres:16-alpine

docker build -t invoice-api:local .

# wait until Postgres accepts connections before migrating
until docker exec capsule-db pg_isready -h localhost -U app -d app; do sleep 1; done

docker run --rm --network capsule \
  -e DATABASE_URL=postgres://app:app@capsule-db:5432/app invoice-api:local \
  node dist/migrate.js

docker run -d --name capsule-api --network capsule -p 3000:3000 \
  -e DATABASE_URL=postgres://app:app@capsule-db:5432/app invoice-api:local

curl -f localhost:3000/readyz
```

## How to verify

Run each of these and paste the output into your README:

- `docker image ls invoice-api:local` - size, compared to the starting Dockerfile.
- `docker run --rm invoice-api:local whoami` - prints a non-root user.
- `docker run --rm invoice-api:local ls -la /app` - no `src/`, no `.env`, no test files.
- `docker run --rm invoice-api:local` with no env - exits non-zero with a readable config error.
- `docker inspect --format '{{.State.Health.Status}}' capsule-api` - reports `healthy` after the start period.
- `time docker stop capsule-api` - completes in well under 10 seconds (graceful shutdown, not SIGKILL).
- Edit one `.ts` file, rebuild, and show the build log where the `npm ci` step is `CACHED`.
- Clean-machine test: run the raw commands on a fresh VM, a teammate's machine, or GitHub Codespaces with your host Node uninstalled or unused. Note the result.
