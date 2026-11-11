## Why this matters

Your ERP dashboard shows "Revenue this month", "Overdue invoices" and "Top 10 customers". Each widget runs an aggregate query over hundreds of thousands of rows. With 10 users it takes 300 ms and nobody cares. With 2,000 accountants opening the dashboard at 9:00 a.m. on the first of the month, Postgres pegs at 100% CPU and every other page in the app slows to a crawl, including the ones that have nothing to do with the dashboard.

The data behind those widgets changes a few times a minute. You are recomputing the same answer thousands of times. A cache stores the answer once and serves it from memory in under a millisecond.

Caching is the single highest-leverage scaling tool you have. It is also the source of some of the most confusing bugs in production: stale prices, users seeing each other's data, and outages caused by the cache itself. This lesson covers both sides.

## What a cache actually is

A cache is a copy of data stored somewhere faster or closer than the source of truth. The source of truth (Postgres) stays authoritative. The cache is disposable: if you deleted every key right now, the system should still be correct, just slower.

Caches exist at many layers:

```
Browser cache -> CDN edge -> Reverse proxy -> App memory -> Redis -> Database buffer cache -> Disk
  (closest to user, least control)                                (closest to data, most control)
```

Two numbers define how useful a cache is:

- **Hit ratio:** the share of reads served from the cache. 95% hit ratio means only 5% of reads reach the database. Going from 90% to 99% cuts database load by 10x, not 10%.
- **Latency gap:** Redis GET is about 0.5 ms. Your aggregate query is 300 ms. The bigger the gap, the bigger the payoff.

## Caching strategies

### Cache-aside (lazy loading)

The application owns the logic. On read: check cache, on miss load from DB and populate the cache. On write: update DB, then delete the cache key.

```
Read:   App --GET--> Redis  (hit? return)
         |  miss
         v
        Postgres --> App --SET with TTL--> Redis --> return

Write:  App --UPDATE--> Postgres
        App --DEL key--> Redis
```

```ts
import Redis from "ioredis";
const redis = new Redis(process.env.REDIS_URL!);

async function getDashboardStats(tenantId: string): Promise<DashboardStats> {
  const key = `tenant:${tenantId}:dashboard:v1`;
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached) as DashboardStats;

  const stats = await db.computeDashboardStats(tenantId); // slow, ~300 ms
  await redis.set(key, JSON.stringify(stats), "EX", 60);  // 60 s TTL
  return stats;
}

async function markInvoicePaid(tenantId: string, invoiceId: string) {
  await db.invoices.update(invoiceId, { status: "paid" });
  await redis.del(`tenant:${tenantId}:dashboard:v1`); // invalidate, don't update
}
```

Why delete instead of updating the cache on write? Because two concurrent writers can update the DB in order A, B but update the cache in order B, A, leaving the cache permanently wrong. Deleting means the next reader rebuilds from the source of truth.

Cache-aside is the default choice for most SaaS apps. Only data someone actually requests gets cached, and a Redis outage degrades performance rather than correctness.

### Write-through

Every write goes to the cache and the database together, synchronously. Reads always hit the cache.

- Pros: cache is always warm and up to date for written keys.
- Cons: every write pays double latency; you cache data nobody may ever read; you still need a strategy for keys that expire.

Good fit: user session data, feature flags, small config tables that are read constantly.

### Write-behind (write-back)

Writes go to the cache only; a background process flushes them to the database later, often batched.

- Pros: extremely fast writes, absorbs write spikes, batching reduces DB load.
- Cons: if the cache dies before flushing, **data is lost**. Ordering and failure handling get complicated.

Good fit: view counters, analytics events, "last seen at" timestamps. Never for invoices, payments or anything with legal weight.

| Strategy | Read path | Write path | Risk |
| --- | --- | --- | --- |
| Cache-aside | Cache, then DB on miss | DB, then delete key | Brief staleness, stampede on miss |
| Write-through | Cache | Cache + DB synchronously | Slower writes, caches unused data |
| Write-behind | Cache | Cache, DB later | Data loss if cache fails |

## TTLs and invalidation

Phil Karlton's line, "There are only two hard things in computer science: cache invalidation and naming things", is a cliche because it is true.

You have two tools:

1. **TTL (time to live):** the key expires automatically. Simple and self-healing. The trade-off is explicit: a 60 s TTL means data can be up to 60 s stale.
2. **Explicit invalidation:** delete the key when the underlying data changes. Fresher, but you must find every code path that changes the data. Miss one, and the cache is wrong until the TTL expires.

**Always use both.** Explicit invalidation for freshness, a TTL as a safety net for the invalidation you forgot.

Choosing a TTL is a business question: "How stale can this be before someone gets hurt?"

| Data | Reasonable TTL |
| --- | --- |
| Product catalog, tax rates | 5–60 minutes |
| Dashboard aggregates | 30–120 seconds |
| User permissions | 30–60 seconds (with invalidation on role change) |
| Account balance, stock for checkout | Do not cache for the decision; read from the DB |

### Versioned keys

Instead of finding and deleting many keys, bump a version number that is part of the key:

```ts
// When anything in the tenant's catalog changes:
await redis.incr(`tenant:${tenantId}:catalog:version`);

// Readers build keys with the current version:
const v = (await redis.get(`tenant:${tenantId}:catalog:version`)) ?? "0";
const key = `tenant:${tenantId}:catalog:v${v}:page:${page}`;
```

Old keys are never read again and expire through their TTL. One INCR invalidates thousands of keys.

### Key design

- Always include the tenant ID. A key like `dashboard:stats` in a multi-tenant app is a data leak waiting to happen.
- Include a schema version (`:v1`) so a deploy that changes the shape of cached objects does not crash on old JSON.
- Use colons as separators by convention: `tenant:42:invoice:991`.

## The cache stampede (thundering herd)

Your dashboard key expires at 09:00:00. In the next 300 ms (the time it takes to recompute) 800 requests arrive. All 800 miss. All 800 run the 300 ms aggregate query at the same time. Postgres falls over, queries slow to 10 s, more requests pile up. This is a **cache stampede**, and it often happens exactly when traffic is highest, because that is when popular keys are being read.

```
t=0     key expires
t=0..300ms   req1 miss -> DB
             req2 miss -> DB
             ...
             req800 miss -> DB   <- 800 identical expensive queries
```

Three fixes, often combined:

### 1. Single-flight with a lock

Only one request recomputes; the others wait briefly and retry the cache.

```ts
async function getWithLock<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = await redis.get(key);
  if (hit) return JSON.parse(hit) as T;

  const lockKey = `${key}:lock`;
  // NX = only set if not exists, PX = lock auto-expires in 5 s if we crash
  const gotLock = await redis.set(lockKey, "1", "PX", 5000, "NX");

  if (gotLock) {
    try {
      const value = await load();
      await redis.set(key, JSON.stringify(value), "EX", ttl);
      return value;
    } finally {
      await redis.del(lockKey);
    }
  }

  // Someone else is loading: wait and retry a few times
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const v = await redis.get(key);
    if (v) return JSON.parse(v) as T;
  }
  return load(); // fallback: give up waiting
}
```

### 2. TTL jitter

If you warm 5,000 keys at the same moment with the same TTL, they all expire at the same moment. Add randomness:

```ts
const ttl = 60 + Math.floor(Math.random() * 15); // 60-74 s
```

### 3. Stale-while-revalidate

Store the value with a "soft" expiry inside the payload and a longer hard TTL in Redis. When the soft expiry passes, return the stale value immediately and trigger one background refresh. Users never wait for the recompute.

## Redis data types you will actually use

Redis is not just a string key-value store. Picking the right type often removes code.

| Type | Commands | SaaS/ERP use |
| --- | --- | --- |
| String | GET, SET EX, INCR | Cached JSON, counters, simple locks |
| Hash | HGET, HSET, HINCRBY | A product's fields; update one field without rewriting the blob |
| List | LPUSH, RPOP, LRANGE | Simple queues, recent activity feed (LTRIM to cap size) |
| Set | SADD, SISMEMBER | Online users, feature flag membership, dedup of processed IDs |
| Sorted set | ZADD, ZRANGE, ZREVRANGE | Leaderboards, highest bids, sliding-window rate limits |
| Stream | XADD, XREADGROUP | Durable event log with consumer groups |

```ts
// Leaderboard of top sales reps this month
await redis.zincrby(`tenant:${t}:sales:2026-11`, amountCents, repId);
const top10 = await redis.zrevrange(`tenant:${t}:sales:2026-11`, 0, 9, "WITHSCORES");
```

Also know about **eviction**. When Redis hits `maxmemory`, it evicts keys according to `maxmemory-policy`. For a pure cache use `allkeys-lru` (evict least recently used). The default, `noeviction`, makes writes fail when memory is full, which is right for a queue and wrong for a cache. Many teams run separate Redis instances for cache and for queues for exactly this reason.

## HTTP and CDN caching

The fastest request is the one that never reaches your server. HTTP has caching built in, controlled by headers.

```
Cache-Control: public, max-age=31536000, immutable      # hashed JS/CSS bundles
Cache-Control: public, s-maxage=300, stale-while-revalidate=60   # public pricing page
Cache-Control: private, max-age=0, must-revalidate      # user-specific dashboard JSON
Cache-Control: no-store                                 # anything with secrets
```

- `max-age` applies to browsers; `s-maxage` applies to shared caches like CDNs.
- `public` allows CDNs to cache; `private` means only the user's browser may store it.
- `ETag` plus `If-None-Match` lets the server answer `304 Not Modified` with no body, saving bandwidth even when content must be revalidated.

A CDN (Cloudflare, CloudFront, Fastly) caches responses at edge locations near users. Put static assets and public pages behind it. **Never** mark authenticated, tenant-specific responses as `public`: a CDN will happily serve tenant A's invoice list to tenant B.

## Common mistakes

- **Caching without a TTL.** Every forgotten invalidation becomes permanent wrong data.
- **Missing tenant ID in keys.** Cross-tenant data leaks are the worst kind of caching bug.
- **Caching the decision data.** Cache the product page, but check stock against the DB inside the checkout transaction.
- **Updating the cache on write instead of deleting.** Concurrent writes leave it inconsistent.
- **Treating Redis as durable storage by accident.** If losing every key would lose business data, it is not a cache, and it needs persistence and backups.
- **Caching tiny fast queries.** A 2 ms indexed lookup gains little from a 0.5 ms Redis call plus serialization. Cache expensive things.
- **No metrics.** If you are not tracking hit ratio, you do not know whether the cache works.

## In the real world

Most production SaaS stacks use cache-aside with Redis, TTLs on every key, explicit deletes on writes, and a CDN in front for static and public content. Stampede protection usually shows up after the first incident where a popular key expired at peak. Shopify, GitHub and Stripe have all written publicly about caching incidents, and the theme is consistent: the cache was fine until it wasn't, and then it took the database down with it. Treat your cache as a performance optimization that the system can survive without, and load test the "cache is empty" scenario.

## Try it

1. Run Redis locally (`docker run -p 6379:6379 redis:7`). Write the `getDashboardStats` function above against a fake loader that sleeps 300 ms. Time 100 sequential calls with and without the cache.
2. Fire 200 concurrent calls (`Promise.all`) right after deleting the key. Count how many times the loader runs. Then add the lock-based single-flight and count again. It should drop to 1.
3. In `redis-cli`, run `MONITOR` while your script runs to see every command. Run `INFO stats` and compute your hit ratio from `keyspace_hits` and `keyspace_misses`.
4. Draw the cache-aside read and write paths on the whiteboard, including where the stampede happens and where the lock sits.
