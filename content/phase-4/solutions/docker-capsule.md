## What a strong solution looks like

A strong submission turns "it works on the VPS" into a short list of verified facts, each backed by pasted command output. The Dockerfile has three clearly named stages, the runtime stage contains only `dist/`, production `node_modules` and `package.json`, it runs as `node`, and it starts with exec-form `CMD ["node", "dist/server.js"]`. The app validates its configuration on startup, exposes `/healthz` and `/readyz` with different semantics, and shuts down cleanly on SIGTERM in well under a second when idle.

The README is half the grade. It shows before and after numbers (for example 1.1 GB and 95 s rebuild versus 170 MB and 6 s), the raw `docker` command sequence that works on a machine with only Docker, and the output of every verification command from the brief, including the build log line where `npm ci` is `CACHED`. Tests still exist and still run: config validation and the readiness handler are covered by unit or integration tests, not only by manual curls.

## Reference approach

### Dockerfile

```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps  --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "dist/server.js"]
```

Key decisions: the lockfile is copied before the source so the install layer survives code changes; `deps` and `runtime` share the same base so native modules match the libc; `--chown` avoids a separate `chown -R` layer that would duplicate `node_modules`. Pinning to a digest (`node:24-alpine@sha256:...`) is the stricter option; a major-version tag plus scheduled rebuilds is the pragmatic one.

### .dockerignore

```gitignore
node_modules
dist
coverage
.git
.github
.env
.env.*
!.env.example
*.log
Dockerfile*
compose*.yaml
```

### Config, readiness and shutdown

```ts
// src/config.ts
const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url(),
});
const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid configuration:", JSON.stringify(parsed.error.issues.map((i) => i.path.join(".") + ": " + i.message)));
  process.exit(1);
}
export const config = parsed.data;
```

Note the error message lists field names only, never the values, so a misconfigured secret is not echoed into logs.

```ts
let shuttingDown = false;
app.get("/readyz", async (_req, reply) => {
  if (shuttingDown) return reply.code(503).send({ status: "shutting_down" });
  try {
    await pool.query("select 1");
    return { status: "ready" };
  } catch {
    return reply.code(503).send({ status: "db_unavailable" });
  }
});

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "shutting down");
  const force = setTimeout(() => process.exit(1), 8_000).unref();
  await app.close();   // stop accepting, wait for in-flight requests
  await pool.end();
  clearTimeout(force);
  process.exit(0);
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
```

Flipping readiness to 503 during shutdown lets a load balancer drain the instance; the forced-exit timer guarantees the container stops before Docker's 10-second SIGKILL even if a connection hangs.

### Tests

- A unit test for the config parser: missing `DATABASE_URL` and a non-numeric `PORT` each produce an error naming the field.
- An integration test (Testcontainers or a compose test database) that `/readyz` returns 200 with Postgres up, and 503 when the pool points at a closed port.
- Optionally a CI job that builds the image and runs `docker run --rm image whoami` and asserts the output is not `root`.

### Verification evidence

The README pastes the output of `docker image ls`, `whoami`, `ls -la /app`, the failing no-env run, `docker inspect` health status, `time docker stop` (typically 0.3-1 s), and the second build log showing `CACHED [deps 4/4] RUN npm ci --omit=dev`.

## Common mistakes

- **`COPY . .` before `npm ci`.** Every source change reinstalls dependencies; the rebuild-time requirement fails.
- **Single `npm ci` then `npm prune --omit=dev` in one stage.** Works, but the build tools and source still ship unless you copy into a fresh stage.
- **Shell-form `CMD` or `npm start`.** Signals do not reach Node; `docker stop` takes exactly 10 seconds every time, which is the giveaway.
- **Exec-form `CMD` without a SIGTERM handler.** As PID 1, Node ignores SIGTERM without a handler, so the result is the same 10-second SIGKILL.
- **`HEALTHCHECK` that calls `/readyz`.** Docker marks the container unhealthy on a database blip, and some platforms then restart it, turning a DB hiccup into an app outage. Liveness should not depend on Postgres.
- **Copying `.env` into the image** or setting secrets with `ENV`/`ARG`. `docker history --no-trunc` exposes them.
- **Migrations run automatically on container start.** Fine for a single instance, but it races with more than one replica; the brief's separate `node dist/migrate.js` run is the habit to build.
- **Claims without evidence.** "It runs on a clean machine" with no output pasted is an assumption.

## Trade-offs worth discussing

- **Alpine versus Debian slim versus distroless.** Alpine is small and has a shell, but musl occasionally breaks native modules or DNS edge cases. Slim (glibc) is larger and more compatible. Distroless removes the shell and package manager, which reduces attack surface but makes debugging and shell-based healthchecks impossible; you need a Node-based healthcheck script.
- **Tag versus digest pinning.** Digests are fully reproducible but never receive security patches unless you bump them; tags pick up patches on rebuild but can change under you. Many teams pin digests and let Renovate or Dependabot bump them.
- **Docker `HEALTHCHECK` versus platform probes.** Kubernetes and most PaaS products ignore the Dockerfile `HEALTHCHECK` and use their own probes, so the instruction mainly helps plain Docker and compose.
- **`--init` versus handling signals in the app.** An init process forwards signals and reaps zombies, but it does not make the app drain connections; you still need the shutdown handler.
- **Compose for production.** Fine for a single host; the moment you need more than one machine, a platform that runs the same image is simpler than growing your own orchestration.

## Grade yourself

| Dimension | Strong | Acceptable | Needs work |
|---|---|---|---|
| Image size and contents | Under 250 MB, `ls -la /app` shows only `dist`, `node_modules`, `package.json`; before/after numbers in README | Multi-stage, but some extra files (source maps, tests) slip in | Single stage, dev dependencies or `src/` in the final image |
| Build caching | Second build log shows dependency layer `CACHED` after a `.ts` change; rebuild time recorded | Cache works but not demonstrated | Install reruns on every change |
| Security | Non-root, no secrets in history, `.dockerignore` covers `.env*` and `.git`, pinned base | Non-root and `.dockerignore`, base pinned only to a floating tag like `lts-alpine` | Runs as root, or `.env` present in any layer |
| Lifecycle | Exec-form `CMD`, SIGTERM handler with readiness flip and forced-exit timeout; `docker stop` under 2 s | Graceful shutdown works, no drain or timeout | `docker stop` takes 10 s |
| Health and config | Separate liveness and readiness, readiness 503 without DB, config errors name fields without echoing values, both covered by tests | Endpoints and validation exist but untested | Healthcheck hits the database, or app starts with missing config |
| Reproducibility | Raw docker sequence in README verified on a clean machine with output pasted; compose waits for `service_healthy` | Commands documented, verified only locally | README requires host Node or Postgres |

## Going further

- Build a distroless variant with a `node healthcheck.js` script and compare size and the number of packages reported by `docker scout` or Trivy.
- Add a CI job that builds the image, scans it with Trivy, fails on high-severity findings, and runs the `whoami` and size assertions automatically.
- Produce a multi-platform image with `docker buildx build --platform linux/amd64,linux/arm64` and verify `sharp` or `bcrypt` (if used) loads on both.
