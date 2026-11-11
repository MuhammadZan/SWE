## Scenario

Your multi-tenant ERP has a "Company Overview" panel that loads on every login. It shows the tenant's plan, enabled modules, fiscal year settings, default currency, tax configuration and a few aggregate counts (active users, open purchase orders). Assembling this metadata takes several joins plus two `COUNT(*)` queries. On a production-sized database it costs roughly 250–400 ms, and it changes only a few times a day.

Every login and every full page refresh pays that cost. At 9:00 a.m. it is the single most expensive query pattern in your database. You will put a Redis cache in front of it using the cache-aside pattern, with an explicit 60-second TTL.

## Scale numbers

- 2,000 tenants, 40,000 users, 15,000 daily active.
- About 120,000 overview loads per day, with 30% of them in the first hour of the business day (about 10 per second at peak, with bursts far higher at the top of the hour).
- Metadata payload: about 3 KB JSON per tenant.
- Target: cache-hit response under 5 ms server-side; overall DB load from this endpoint reduced by more than 90%.

## Starting point

- A local Redis 7 instance (Docker is fine: `docker run -p 6379:6379 redis:7`).
- A Node/TypeScript project using `ioredis`.
- A "slow database read". Use a real Postgres query if you have one from Phase 2, or simulate one with a function that waits 300 ms and returns a deterministic object for a tenant ID.

## What to build

1. A function `getTenantMetadata(tenantId: string)` that:
   - Checks Redis for a tenant-scoped key.
   - On a hit, parses and returns the cached payload.
   - On a miss, runs the slow read, writes the result to Redis with an explicit 60-second TTL (set atomically with the value, not as a separate EXPIRE call), and returns it.
2. An invalidation function `invalidateTenantMetadata(tenantId)` that is called whenever tenant settings change.
3. A small HTTP endpoint or CLI script that exercises both paths and logs `HIT` or `MISS` plus duration for each call.
4. A benchmark script that measures latency for 100 sequential calls cold and warm, and prints both.
5. A stampede test: delete the key, fire 200 concurrent calls, count how many times the slow loader actually ran. Then add a single-flight mechanism (a Redis `SET NX PX` lock holding a unique token and released with a compare-and-delete Lua script, or an in-process promise map) and show the count drops to 1 (or 1 per process).

6. Automated tests (Vitest or `node:test`) for the core logic, runnable with `npm test`: a miss calls the loader and writes the key with a TTL between 1 and 60; a second call is a hit and does not call the loader; after invalidation the next call is a miss; after the TTL passes the next call is a miss (use a short TTL in the test or inject the TTL, rather than sleeping 60 s); with Redis unavailable the function still returns loader data; and 200 concurrent misses with single-flight call the loader once. Run them against a real Redis (Docker) rather than a mock, so you test real `SET ... EX` and `NX` behavior.

Optionally draw the read path and invalidation path on the whiteboard; it is a useful habit even for a small exercise.

## Constraints

- Keys must include the tenant ID and a schema version, for example `tenant:{id}:metadata:v1`.
- No key may be written without a TTL.
- The cache must be optional: if Redis is down or times out, the function falls back to the database and still returns correct data (log the failure, do not throw).
- Write all logic by hand. Do not use a caching library that hides the pattern.

## How to verify

- `redis-cli TTL tenant:42:metadata:v1` right after a miss returns a value between 1 and 60.
- Waiting 61 seconds and calling again produces a MISS.
- Calling the invalidation function and then reading produces a MISS with fresh data.
- Your benchmark shows warm calls at least 50x faster than cold calls.
- `redis-cli INFO stats` shows `keyspace_hits` and `keyspace_misses`; compute and report the hit ratio from your benchmark run.
- Stopping the Redis container mid-run does not crash your script; calls slow down to DB speed and keep returning correct data.
- The stampede test output shows loader-call counts before and after adding single-flight.
- `npm test` passes and covers hit, miss, TTL expiry, invalidation, Redis-down fallback and single-flight.

Commit a short README with your measured numbers in a table: cold p50/p95, warm p50/p95, hit ratio, and stampede loader count before and after.
