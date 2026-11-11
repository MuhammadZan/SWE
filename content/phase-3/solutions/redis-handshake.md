## What a strong solution looks like

A strong submission is small and boring in the right ways. `getTenantMetadata` is one short function that reads a tenant-scoped, versioned key, falls back to the loader on a miss and writes the value and its TTL in a single `SET ... EX` command. Redis is treated as optional: every cache call is wrapped so that a timeout or a refused connection logs a warning and falls through to the database instead of failing the request. Invalidation is one `DEL` called from every code path that changes tenant settings.

What separates strong from acceptable is evidence. The README has a table of measured numbers (cold and warm p50/p95, hit ratio from `INFO stats`, loader count before and after single-flight), and a test suite proves the behavior: hit, miss, TTL expiry, invalidation, Redis-down fallback and single-flight. The single-flight lock uses a unique token and a compare-and-delete release, and the author can explain why a plain `DEL` is wrong.

## Reference approach

### The cache-aside function

Inject the Redis client, the loader and the TTL so tests can control them.

```ts
import type { Redis } from "ioredis";

export type Deps = {
  redis: Redis;
  loadFromDb: (tenantId: string) => Promise<TenantMetadata>;
  ttlSeconds?: number;
  log?: (msg: string, err?: unknown) => void;
};

export const metadataKey = (tenantId: string) => `tenant:${tenantId}:metadata:v1`;

export async function getTenantMetadata(tenantId: string, deps: Deps): Promise<TenantMetadata> {
  const { redis, loadFromDb, ttlSeconds = 60, log = console.warn } = deps;
  const key = metadataKey(tenantId);

  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached) as TenantMetadata;
  } catch (err) {
    log("cache read failed, falling back to DB", err);
    return loadFromDb(tenantId); // Redis is down: skip the write too
  }

  const fresh = await loadFromDb(tenantId);
  try {
    await redis.set(key, JSON.stringify(fresh), "EX", ttlSeconds); // value + TTL in one command
  } catch (err) {
    log("cache write failed", err);
  }
  return fresh;
}
```

The client is created with `new Redis(url, { commandTimeout: 50, maxRetriesPerRequest: 1, enableOfflineQueue: false })`. Without `enableOfflineQueue: false` and a short timeout, ioredis queues commands while disconnected and your "fallback" becomes a request that hangs for seconds.

### Single-flight with a token

```ts
const RELEASE = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

const token = randomUUID();
const got = await redis.set(`${key}:lock`, token, "PX", 5000, "NX");
if (got === "OK") {
  try { /* load, SET EX, return */ }
  finally { await redis.eval(RELEASE, 1, `${key}:lock`, token); }
}
// else: poll GET every 50 ms for up to ~1 s, then load directly
```

An in-process `Map<string, Promise<T>>` is an acceptable alternative and is simpler; it gives one load per process, not one per fleet. Saying which one you chose and why is part of the answer.

### Tests

Run them against a real Redis in Docker. Mocks will happily accept a `SET` without a TTL.

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

describe("getTenantMetadata", () => {
  beforeEach(async () => { await redis.flushdb(); });

  it("misses, loads once, then hits", async () => {
    const load = vi.fn(async () => ({ plan: "pro" }));
    await getTenantMetadata("42", { redis, loadFromDb: load });
    await getTenantMetadata("42", { redis, loadFromDb: load });
    expect(load).toHaveBeenCalledTimes(1);
    const ttl = await redis.ttl(metadataKey("42"));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  it("expires after the TTL", async () => {
    const load = vi.fn(async () => ({ plan: "pro" }));
    await getTenantMetadata("42", { redis, loadFromDb: load, ttlSeconds: 1 });
    await new Promise((r) => setTimeout(r, 1100));
    await getTenantMetadata("42", { redis, loadFromDb: load, ttlSeconds: 1 });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("returns DB data when Redis is unreachable", async () => {
    const dead = new Redis("redis://127.0.0.1:6390", { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 0 });
    const out = await getTenantMetadata("42", { redis: dead, loadFromDb: async () => ({ plan: "pro" }), log: () => {} });
    expect(out).toEqual({ plan: "pro" });
  });

  it("single-flight runs the loader once for 200 concurrent misses", async () => {
    const load = vi.fn(async () => { await new Promise((r) => setTimeout(r, 300)); return { plan: "pro" }; });
    await Promise.all(Array.from({ length: 200 }, () => getWithSingleFlight("42", { redis, loadFromDb: load })));
    expect(load).toHaveBeenCalledTimes(1);
  });
});
```

Add one more for invalidation (call, invalidate, call: loader count 2).

### Expected numbers

With a 300 ms simulated loader and local Redis: cold p50 about 300 ms, warm p50 about 0.2–1 ms, so warm is 300x or more faster. A 100-call warm benchmark after one cold call gives a hit ratio of 99/100. Without single-flight, 200 concurrent misses run the loader close to 200 times; with it, 1.

## Common mistakes

- **`SET` then `EXPIRE` as two calls.** A crash between them leaves a key with no TTL forever. Use `SET key value EX 60`.
- **Releasing the lock with `DEL`.** If the load outlasts the lock TTL, you delete another request's lock. It rarely shows in a demo and bites under real load.
- **Fallback that hangs.** Catching the error is not enough if ioredis's offline queue holds the command for 10+ seconds. Measure the Redis-down path; it should cost about one DB read.
- **Caching `null`/missing tenants without thought.** Either cache a sentinel with a short TTL or do not cache, but decide deliberately (caching nothing lets a bad tenant ID hammer the DB).
- **Hit ratio from your own counters only.** The brief asks for `keyspace_hits`/`keyspace_misses`, which include every GET on the instance. Reset with `CONFIG RESETSTAT` before the run.
- **Benchmarking with averages.** Report p50 and p95.

## Trade-offs worth discussing

- **60 s TTL vs explicit invalidation.** With invalidation on every settings write, the TTL is only a safety net; you could raise it. The aggregate counts (open POs, active users) cannot be invalidated cheaply, so 60 s staleness is the honest contract for them. Splitting static settings and counts into two keys with different TTLs is a good answer.
- **Redis lock vs in-process single-flight.** The Redis lock deduplicates across all instances but adds round trips and polling; the in-process map is zero-latency but allows one load per instance. With 3 instances, 3 loads is usually fine.
- **Delete vs update on write.** Deleting is safer under concurrent writers; updating keeps the cache warm. For 3 KB of rarely changed data, delete.
- **JSON string vs hash.** A string is one round trip and simple; a hash lets you update one field but complicates TTL and versioning.

## Grade yourself

| Dimension | Strong | Acceptable | Needs work |
| --- | --- | --- | --- |
| Key design and TTL | `tenant:{id}:metadata:v1`, every write uses `SET ... EX`, a test asserts the TTL | Correct keys, TTL set but not tested | Key lacks tenant or version, or `SET` + separate `EXPIRE` |
| Redis-down behavior | Short timeout, offline queue disabled, tested; calls return in about DB time | Try/catch fallback works but slow or untested | Function throws or hangs when Redis is down |
| Single-flight | Token + Lua compare-and-delete (or promise map), test proves loader runs once | Works, but releases with plain `DEL` | Not implemented or not measured |
| Tests | `npm test` covers hit, miss, TTL, invalidation, Redis-down and single-flight against real Redis | Tests for hit/miss only, or mocks only | No automated tests |
| Measurement | README table with p50/p95 cold and warm, hit ratio from INFO, stampede counts | Some numbers, averages only | Claims without numbers |

## Going further

1. Add stale-while-revalidate: store `{ value, softExpiresAt }` with a longer hard TTL, return stale data immediately and refresh in the background under the same lock.
2. Run the benchmark against three API instances behind Nginx with each single-flight variant and compare loader counts and p95 at the top of the hour.
3. Try Redis client-side caching (`CLIENT TRACKING`) for this read-mostly payload and measure what it saves over a local network round trip.
