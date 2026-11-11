## Why this matters

It is 09:05 on the first working day of the month. The ERP is slow for everyone, the API has 3-second p95s, and someone in the incident channel says "the database is overloaded, let's double the instance size". Sometimes that works. Often it does nothing, because the database was not short of CPU: it was waiting on a lock held by a migration, or out of connections because a serverless deploy opened 900 of them, or reading from disk because the working set outgrew memory.

In Phase 2 you learned to fix one slow query with `EXPLAIN ANALYZE`. This lesson is about the step before that: finding *which* query and *which* resource, on a live system, under pressure. The method is always the same: identify the saturated resource, find the queries consuming it, then fix the cheapest thing.

## The method: which resource is saturated?

A database runs out of exactly one of a small number of things at a time:

| Resource | Symptom | First place to look |
|---|---|---|
| CPU | CPU near 100%, queries slower across the board | `pg_stat_statements` by `total_exec_time`; missing indexes, seq scans, big sorts/hash joins |
| Disk I/O | High read IOPS/latency, CPU idle-ish, `wait_event_type = 'IO'` | Cache hit ratio, `shared_blks_read` per query, working set vs RAM |
| Memory | Low cache hit ratio, temp files, OOM kills | `temp_blks_written`, `work_mem`, `shared_buffers` |
| Locks / contention | Low CPU, low I/O, but many sessions waiting | `pg_stat_activity` with `wait_event_type = 'Lock'`, blocking tree |
| Connections | `too many clients`, pool timeouts in the app, CPU fine | `count(*)` from `pg_stat_activity` by state, app pool metrics |
| Network / round trips | DB time small, request time large | App traces: query count per request (Phase 2 N+1) |

The two most common misdiagnoses: blaming CPU when sessions are actually **waiting** (locks, I/O, connections), and blaming the database when the app is doing 300 round trips per request.

A quick triage, in order:

1. OS / cloud metrics: CPU, read/write IOPS, disk latency, free memory, network. (CloudWatch / RDS Performance Insights, Neon and Supabase dashboards, or `top`, `iostat -x 1`, `vmstat 1` on a VM.)
2. What are sessions doing right now? (`pg_stat_activity` and wait events.)
3. What has been expensive over time? (`pg_stat_statements`.)
4. Why is that one query expensive? (`EXPLAIN (ANALYZE, BUFFERS)`, `auto_explain`.)

## Snapshot: what is happening right now

```sql
-- Who is doing what, longest-running first
SELECT pid,
       usename,
       application_name,
       state,
       wait_event_type,
       wait_event,
       now() - xact_start  AS xact_age,
       now() - query_start AS query_age,
       left(query, 120)    AS query
FROM pg_stat_activity
WHERE backend_type = 'client backend'
  AND state <> 'idle'
ORDER BY xact_start NULLS LAST
LIMIT 30;
```

```sql
-- Summary: what are sessions waiting on?
SELECT state, wait_event_type, wait_event, count(*)
FROM pg_stat_activity
WHERE backend_type = 'client backend'
GROUP BY 1, 2, 3
ORDER BY count(*) DESC;
```

How to read wait events:

- `wait_event_type` NULL with `state = 'active'`: on CPU. Many of these means CPU-bound.
- `IO` (`DataFileRead`): reading pages from disk or OS cache. Working set too big or a scan that should be an index lookup.
- `Lock` (`relation`, `tuple`, `transactionid`): waiting on another session. Go to the blocking query below.
- `LWLock`: internal contention (WAL insertion, buffer mapping, lock manager with many partitions). Usually a sign of very high concurrency.
- `Client` (`ClientRead`) with `state = 'idle in transaction'`: the **app** is holding a transaction open while doing something else. A classic cause of lock pile-ups.

## Lock monitoring: who blocks whom

```sql
SELECT blocked.pid                    AS blocked_pid,
       left(blocked.query, 80)        AS blocked_query,
       now() - blocked.query_start    AS blocked_for,
       blocking.pid                   AS blocking_pid,
       blocking.state                 AS blocking_state,
       now() - blocking.xact_start    AS blocking_xact_age,
       left(blocking.query, 80)       AS blocking_query
FROM pg_stat_activity blocked
JOIN LATERAL unnest(pg_blocking_pids(blocked.pid)) AS b(pid) ON true
JOIN pg_stat_activity blocking ON blocking.pid = b.pid
ORDER BY blocked_for DESC;
```

The typical picture: one root blocker (often `idle in transaction`, or a migration waiting for an `ACCESS EXCLUSIVE` lock) and a fan of hundreds of queries behind it. Emergency options: `SELECT pg_cancel_backend(pid)` (cancel the query) or `pg_terminate_backend(pid)` (kill the session). Then fix the cause: transaction timeouts, `lock_timeout` on migrations, shorter transactions.

## History: pg_stat_statements

`pg_stat_statements` aggregates every normalized query (literals replaced with `$1`) with call counts, timing and buffer usage. It is the single most useful performance tool in Postgres. It requires `shared_preload_libraries = 'pg_stat_statements'` and a restart; most managed services (RDS, Aurora, Cloud SQL, Neon, Supabase) preload it, and you run `CREATE EXTENSION pg_stat_statements;` once.

```sql
-- Top 15 by total time: where the database spends its life
SELECT queryid,
       calls,
       round(total_exec_time::numeric, 0)                        AS total_ms,
       round(mean_exec_time::numeric, 2)                         AS mean_ms,
       round((100 * total_exec_time / sum(total_exec_time) OVER ())::numeric, 1) AS pct,
       rows / NULLIF(calls, 0)                                   AS rows_per_call,
       shared_blks_hit + shared_blks_read                        AS blks_touched,
       round(100.0 * shared_blks_hit / NULLIF(shared_blks_hit + shared_blks_read, 0), 1) AS hit_pct,
       temp_blks_written,
       left(query, 100)                                          AS query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 15;
```

Read it three ways:

- **By `total_exec_time`**: the aggregate cost. A 2 ms query called 40 million times a day beats a 9 s report called twice. This list is what to optimize for throughput and CPU.
- **By `mean_exec_time`**: what users feel on individual endpoints.
- **By `shared_blks_read` or `temp_blks_written`**: I/O and memory pressure. Temp blocks mean sorts or hashes spilled to disk because `work_mem` was too small for that query.

Reset the stats before a load test or after a deploy (`SELECT pg_stat_statements_reset();`) so you compare like with like. Column names changed across versions (`total_time` became `total_exec_time` in Postgres 13); adjust if you are on something old.

## Cache hit ratio and memory

```sql
-- Buffer cache hit ratio per database (since stats reset)
SELECT datname,
       round(100.0 * blks_hit / NULLIF(blks_hit + blks_read, 0), 2) AS cache_hit_pct,
       temp_files,
       pg_size_pretty(temp_bytes) AS temp_bytes
FROM pg_stat_database
WHERE datname = current_database();

-- Per table: which tables are read from outside shared_buffers?
SELECT relname,
       heap_blks_read, heap_blks_hit,
       round(100.0 * heap_blks_hit / NULLIF(heap_blks_hit + heap_blks_read, 0), 1) AS hit_pct
FROM pg_statio_user_tables
ORDER BY heap_blks_read DESC
LIMIT 10;
```

For an OLTP workload you want above roughly 99%. Two caveats: a "read" here may still be served by the OS page cache (so it is cheaper than real disk), and a ratio is an average that can hide one table thrashing. If the ratio drops over months as data grows, your working set has outgrown RAM: that is a strong signal for archiving, partitioning, or more memory, rather than more CPU.

Also check maintenance health, because bloat makes everything bigger:

```sql
SELECT relname, n_live_tup, n_dead_tup,
       round(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 1) AS dead_pct,
       last_autovacuum, last_autoanalyze
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT 10;
```

## One query in depth: EXPLAIN (ANALYZE, BUFFERS) and auto_explain

You already know how to read plans. Two additions for production work:

- Always include `BUFFERS` (default with `ANALYZE` from Postgres 18). `shared read=61210` tells you about I/O that timing alone hides, and buffers are stable across runs where timings are not. Turn on `track_io_timing` to see I/O time per node.
- Be careful running `ANALYZE` on writes in production: it executes the statement. Wrap in `BEGIN; EXPLAIN ANALYZE ...; ROLLBACK;`.

The slow query you care about often only misbehaves for one tenant at 09:00 with certain parameters. `auto_explain` logs the actual plan when it happens:

```sql
-- per session for investigation (superuser or allowed by your provider):
LOAD 'auto_explain';
SET auto_explain.log_min_duration = '500ms';
SET auto_explain.log_analyze = on;
SET auto_explain.log_buffers = on;
SET auto_explain.log_nested_statements = on;
```

For the whole server, add it to `shared_preload_libraries` or `session_preload_libraries` (on RDS/Aurora via the parameter group). `log_analyze` adds timing overhead to every statement; in hot production systems consider `auto_explain.log_timing = off` and a sample rate (`auto_explain.sample_rate = 0.1`).

## Connections: why they are expensive

Every Postgres connection is a separate OS **process** (Postgres 18 is still process-per-connection). Each costs several MB of baseline memory, plus `work_mem` per sort/hash node while a query runs, plus per-connection catalog caches. More importantly, past a point more active connections reduce throughput: they contend on CPU cores, locks, and internal structures. 500 active queries on a 16-core box do not run 500-wide; they time-slice and thrash.

Pool sizing is arithmetic, not intuition. By Little's law, the number of connections that are busy at any instant is:

```
busy connections = throughput (queries/s) x average time in database (s)
                 = 3,000 q/s x 0.004 s = 12
```

So 3,000 queries per second at 4 ms each need about 12 connections actively working. A starting rule for the database side of the pool is a small multiple of CPU cores (the often-quoted heuristic is `cores x 2 + effective disks`), so 20 to 40 server connections for a 16-vCPU instance, then measure. Then split across clients:

```
Postgres max_connections = 200, reserve 20 for admin/replication/migrations
=> 180 for apps
API:     12 instances x pool 10 = 120
Workers:  6 instances x pool 8  =  48
Cron/BI:                           12
Total                            = 180
```

If the sum of every app's pool exceeds `max_connections`, you will see `FATAL: sorry, too many clients already` exactly when you scale out under load. Raising `max_connections` to 2,000 is not the fix; it moves the failure to memory and contention.

## PgBouncer and transaction pooling

PgBouncer (or a managed equivalent: RDS Proxy, Supabase Supavisor, Neon's built-in PgBouncer endpoint) multiplexes many client connections onto few server connections.

```
 2,000 client connections   -->  PgBouncer  -->  40 Postgres connections
 (API, workers, lambdas)          pool_mode = transaction
```

Modes: **session** (a client keeps one server connection until it disconnects; little multiplexing), **transaction** (a server connection is assigned per transaction and returned at `COMMIT`; the useful mode), **statement** (per statement; no multi-statement transactions).

In transaction mode, anything that lives in the **session** is broken, because your next transaction may run on a different server connection:

| Feature | Problem | Use instead |
|---|---|---|
| `SET search_path` / `SET app.tenant_id` | Leaks to another client, or is lost | `SET LOCAL` / `set_config(..., true)` inside the transaction |
| Session advisory locks | Held by the wrong connection | `pg_advisory_xact_lock` |
| `LISTEN/NOTIFY` | Notifications go to a connection you no longer own | A dedicated direct connection |
| Temp tables, `WITH HOLD` cursors | Disappear or leak | Keep inside one transaction |
| Named prepared statements | Prepared on a different server connection | PgBouncer 1.21+ with `max_prepared_statements` set, or disable named prepared statements in the driver |

ORMs often need a flag for this (for example Prisma's `pgbouncer=true` connection parameter on older setups). Migrations should use a **direct** connection, not the pooler: they rely on session behaviour and long transactions.

## Serverless connection storms

Serverless functions (Lambda, Vercel functions) each hold their own pool. A traffic spike scales to 800 concurrent instances, each opens a connection, and the database falls over, even though total query load is modest. Fixes:

- Always connect through a pooler endpoint (Neon's `-pooler` host, Supabase's transaction-mode port, RDS Proxy).
- Set the per-instance pool size to 1 or 2 and short idle timeouts.
- Or use an HTTP/WebSocket driver designed for serverless (Neon's serverless driver, Data API style services).
- Cap concurrency of the function itself if the platform allows.

RDS Proxy has its own caveat: session-level state causes **pinning** (the client keeps a dedicated server connection), silently disabling multiplexing. Check its pinning metrics.

## Common mistakes

- Scaling the instance before checking wait events, when sessions were waiting on a lock.
- Optimizing the slowest query by mean time while a 2 ms query with 50 million calls dominates `total_exec_time`.
- Setting `max_connections = 1000` to fix "too many clients", then running out of memory.
- Pool size per instance chosen without multiplying by instance count.
- `SET` (not `SET LOCAL`) for tenant context behind a transaction pooler, leaking tenant context between requests.
- Running migrations through PgBouncer in transaction mode.
- Trusting the cache hit ratio average while one large table is read from disk on every report.

## In the real world

Most incident runbooks for Postgres start with the same three queries: active sessions by wait event, the blocking tree, and top statements from `pg_stat_statements`. Managed platforms wrap these in UIs (RDS Performance Insights' "DB load by wait", Supabase's query performance report, Neon's monitoring), but the underlying data is these views, and knowing the SQL lets you work on any provider. Interviewers ask "the database is slow, walk me through what you do" precisely to see whether you start with measurement or with guesses.

## Try it

Enable `pg_stat_statements` in a Docker Postgres (`command: postgres -c shared_preload_libraries=pg_stat_statements -c track_io_timing=on`). Run a load script that mixes a fast indexed lookup (thousands of calls) with an unindexed report (a few calls). Reset stats, run the load for a minute, and confirm which query tops `total_exec_time` versus `mean_exec_time`. Then open a transaction in `psql`, `UPDATE` one row, leave it open, run the same update from the load script, and find the root blocker with the lock query above.
