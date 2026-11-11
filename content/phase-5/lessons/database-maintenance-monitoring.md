## Why this matters

The ERP has run happily for two years. Nobody touches the database; it is managed, after all. Then, over a few weeks, the `stock_movements` page gets slower. The table has 3 million live rows but takes 41 GB on disk. Queries that used an index now scan. One Friday the primary's disk hits 95%, and a week later the logs start printing:

```
WARNING:  database "erp" must be vacuumed within 38000000 transactions
```

Three separate problems are hiding here: bloat from dead rows, stale statistics misleading the planner, and approaching transaction ID wraparound, which ends with Postgres refusing writes. All three come from the same root: maintenance work that Postgres does in the background, which can fall behind silently. This lesson explains why Postgres needs it, how to tune it per table, and which metrics tell you it is falling behind before customers do.

Phase 4 covered application metrics and alerting in general. Here you apply that to the database itself.

## MVCC and why dead rows exist

Postgres implements MVCC (multi-version concurrency control) by never updating a row in place. An `UPDATE` writes a **new version** of the row and marks the old one as expired by the updating transaction's ID. A `DELETE` just marks the row expired.

```
UPDATE stock SET qty = 7 WHERE sku = 'A1';

 page 12: [ (A1, qty 9) xmin=100 xmax=250 ]  <- dead once tx 250 commits
          [ (A1, qty 7) xmin=250 xmax=0   ]  <- live version
```

Old versions must stay as long as any running transaction might still need to see them. Once no snapshot can see them, they are **dead tuples**: wasted space that every sequential scan still reads, and that indexes still point at.

`VACUUM` reclaims that space for reuse within the table (it does not normally shrink the file), removes dead index entries, updates the visibility map (which makes index-only scans possible), and **freezes** old rows (more on that below).

A table with heavy updates and slow vacuuming bloats: the file grows, cache efficiency drops, and scans slow down. High-churn ERP tables like `stock_levels`, `job_queue`, `sessions` and `invoice_status` are the usual suspects.

## Autovacuum and per-table tuning

The autovacuum launcher starts workers that vacuum a table when:

```
dead tuples > autovacuum_vacuum_threshold + autovacuum_vacuum_scale_factor * reltuples
              (default 50)                   (default 0.2)
```

With the defaults, a 100-million-row table waits for **20 million** dead rows before vacuum starts. That is the main reason big tables bloat. Global defaults suit small tables; override them per hot table:

```sql
ALTER TABLE app.stock_levels SET (
  autovacuum_vacuum_scale_factor = 0.01,   -- 1% instead of 20%
  autovacuum_vacuum_threshold = 1000,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_vacuum_cost_limit = 2000      -- let vacuum work faster on this table
);
```

Postgres 13+ also vacuums insert-only tables (`autovacuum_vacuum_insert_threshold` and `_scale_factor`), which matters for append-heavy tables like `audit_log` so their visibility maps and freezing stay current. Postgres 18 adds `autovacuum_vacuum_max_threshold`, a cap on the trigger point for very large tables.

Globally, the usual production adjustments are:

| Setting | Default | Why change |
|---|---|---|
| `autovacuum_max_workers` | 3 | many busy tables, workers always busy |
| `autovacuum_vacuum_cost_limit` | -1 (uses `vacuum_cost_limit`, 200) | vacuum is throttled too hard for fast SSDs |
| `autovacuum_naptime` | 1min | rarely needs changing |
| `maintenance_work_mem` / `autovacuum_work_mem` | 64MB | larger means fewer index passes per vacuum |

On managed services you change these via parameter groups or flags; the concepts are identical.

### What blocks vacuum

Vacuum can only remove rows that **no** snapshot can see. These hold back the cleanup horizon for the **whole cluster**:

- Long-running transactions, including `idle in transaction` sessions from a bug or a forgotten psql.
- Abandoned replication slots, and replicas with `hot_standby_feedback = on` running long queries.
- Forgotten prepared transactions (`pg_prepared_xacts`).

```sql
-- the oldest transactions in the system
SELECT pid, usename, state, now() - xact_start AS age, left(query, 60)
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
ORDER BY xact_start
LIMIT 5;
```

Defend with `idle_in_transaction_session_timeout = '60s'` on app roles and alerts on transaction age. One analytics transaction left open over a weekend can bloat every hot table in the database.

### Fixing existing bloat

`VACUUM` will not give space back to the OS. `VACUUM FULL` will, but it rewrites the table under `ACCESS EXCLUSIVE`: an outage on a hot table. The online alternative is **pg_repack** (available on RDS, Cloud SQL and others), which rebuilds the table and swaps it in with only brief locks. Measure first: `pgstattuple` gives exact dead-space numbers, and `n_dead_tup` in `pg_stat_user_tables` is a cheap estimate.

```sql
SELECT relname, n_live_tup, n_dead_tup,
       round(100.0 * n_dead_tup / nullif(n_live_tup + n_dead_tup, 0), 1) AS dead_pct,
       last_autovacuum, last_autoanalyze,
       pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT 10;
```

HOT updates (heap-only tuples) reduce bloat on indexes: if an update changes no indexed column and the new version fits on the same page, no index entries are added. Setting `fillfactor = 90` on update-heavy tables leaves room for that, and avoiding unnecessary indexes on frequently updated columns helps more.

## Transaction ID wraparound

Transaction IDs are 32-bit, so about 4 billion values that wrap around; visibility comparisons work within a window of about 2 billion. To keep old rows visible forever, vacuum **freezes** them, marking them as older than every transaction. If the oldest unfrozen XID in a database approaches 2 billion transactions old, Postgres first warns, then stops assigning new transaction IDs: the database goes read-only until a manual vacuum completes, which on a large table can take hours.

```mermaid
flowchart LR
  Z["age(datfrozenxid) = 0"] --> A["200M<br/>autovacuum_freeze_max_age:<br/>anti-wraparound vacuum is forced on the table"]
  A --> B["1.6B<br/>vacuum_failsafe_age:<br/>vacuum skips throttling (PG14+)"]
  B --> C["~2B<br/>writes stop"]
```

Anti-wraparound autovacuums run even when autovacuum is disabled for a table and cannot be skipped. They also do not give way to lock requests like normal autovacuum does, so a migration can end up queued behind one.

```sql
SELECT datname, age(datfrozenxid) AS xid_age,
       round(100.0 * age(datfrozenxid) / 2000000000, 1) AS pct_to_wraparound
FROM pg_database ORDER BY xid_age DESC;

SELECT relname, age(relfrozenxid) AS xid_age
FROM pg_class WHERE relkind = 'r' ORDER BY xid_age DESC LIMIT 10;
```

Alert at a warning around 500 million and critical around 1 billion. Healthy systems sit well below 200 to 300 million. If it climbs, something is blocking vacuum (see above), or a giant table's freeze vacuum keeps getting cancelled.

## ANALYZE and statistics

The planner chooses plans from statistics: row counts, most common values, histograms and correlation per column, collected by `ANALYZE` (autovacuum runs it too, by default after 10% of rows change). Stale stats produce bad plans: a filter estimated at 10 rows that actually returns 400,000 picks a nested loop that runs for minutes.

- Run `ANALYZE` after bulk loads and big backfills; do not wait for autovacuum.
- After a major-version upgrade with `pg_upgrade`, run `vacuumdb --all --analyze-in-stages` (older versions do not carry statistics over; Postgres 18 preserves most of them, but check the release notes for your path).
- For skewed columns like `tenant_id`, where one tenant has 40% of rows, raise the sample: `ALTER TABLE invoices ALTER COLUMN tenant_id SET STATISTICS 1000;`.
- For correlated columns, extended statistics (`CREATE STATISTICS ... (dependencies) ON country, vat_rate FROM invoices`) fix multiplied-selectivity errors. Reading the resulting plans is covered in the diagnosing-bottlenecks lesson.

## Reindexing

B-tree indexes bloat too, especially with random keys (UUIDv4) and heavy deletes, and indexes can be left `INVALID` by failed concurrent builds. Rebuild online:

```sql
REINDEX INDEX CONCURRENTLY app.invoices_tenant_due_idx;  -- Postgres 12+
```

Postgres 13+ deduplicates B-tree entries, which reduces bloat for low-cardinality indexes. Using time-ordered keys (UUIDv7, `bigint` identity) keeps inserts at the right edge of the index and avoids much of the problem in the first place. Do not schedule blanket weekly `REINDEX` jobs; measure bloat and rebuild the indexes that need it.

## What to dashboard and alert on

Start from the questions you would ask in an incident, then map each to a metric.

| Signal | Source | Alert idea |
|---|---|---|
| Connections used vs max | `pg_stat_activity`, `max_connections` | > 80% for 5 min |
| Connections by state | `pg_stat_activity.state` | `idle in transaction` count > 5 for 5 min |
| Longest transaction age | `pg_stat_activity.xact_start` | > 10 min (OLTP) |
| Lock waits | `pg_locks` where `NOT granted`, `pg_blocking_pids` | waiting sessions > 10 for 2 min |
| Deadlocks | `pg_stat_database.deadlocks` | rate > 0 sustained |
| Replication lag | `pg_stat_replication.replay_lag`, bytes behind | > 30 s or > 1 GB |
| Inactive replication slots | `pg_replication_slots.active` | any inactive slot holding WAL |
| WAL archiving | `pg_stat_archiver` | last failure newer than last success |
| Cache hit ratio | `pg_stat_database.blks_hit / (blks_hit + blks_read)` | trend; below ~99% on OLTP is worth a look |
| Disk used and growth | node / cloud metrics | < 20% free, or predicted full in < 7 days |
| Dead tuples and last autovacuum | `pg_stat_user_tables` | dead_pct > 20% on large tables |
| XID age | `age(datfrozenxid)` | > 500M warning, > 1B critical |
| Slow queries | `pg_stat_statements` mean / total time | top-N by total time, reviewed weekly |
| Temp files | `pg_stat_database.temp_bytes` | spikes mean `work_mem` too small for some query |
| Checkpoints | `pg_stat_checkpointer` (PG17+) / `pg_stat_bgwriter` | many requested (not timed) checkpoints |

Cache hit ratio is a trend metric, not a goal; a reporting database can be healthy at 90%. Alert on things that need a human now (connections, lag, disk, XID age, archiving failures), and review the rest on a dashboard.

### postgres_exporter and Grafana

The Prometheus community **postgres_exporter** connects to Postgres and exposes these views as metrics:

```yaml
# compose.yaml (excerpt)
postgres-exporter:
  image: quay.io/prometheuscommunity/postgres-exporter:v0.15.0
  environment:
    DATA_SOURCE_NAME: "postgresql://monitor:${MONITOR_PW}@pg-primary:5432/erp?sslmode=disable"
  ports: ["9187:9187"]
```

Give it a dedicated login with the predefined `pg_monitor` role: `CREATE ROLE monitor LOGIN PASSWORD '...' IN ROLE pg_monitor;`. It needs nothing more. Metric names vary between exporter versions and enabled collectors, so check `/metrics` before writing rules:

```yaml
# prometheus alert rules (excerpt)
groups:
  - name: postgres
    rules:
      - alert: PostgresDown
        expr: pg_up == 0
        for: 1m
      - alert: PostgresConnectionsHigh
        expr: sum by (instance) (pg_stat_activity_count) / on (instance) pg_settings_max_connections > 0.8
        for: 5m
      - alert: PostgresDiskFullIn7Days
        expr: predict_linear(node_filesystem_avail_bytes{mountpoint="/var/lib/postgresql"}[6h], 7*24*3600) < 0
        for: 30m
```

For anything the exporter does not expose (XID age per table, oldest transaction), add a custom query or a small sidecar. Grafana.com has community Postgres dashboards you can import as a starting point; trim them to the panels you actually use. Managed services give you a lot of this through RDS Performance Insights / CloudWatch Database Insights, Cloud SQL Query Insights, and the Neon and Supabase consoles, but you still need your own alerts on the signals above.

## Capacity planning

Use the trends you are now collecting:

- **Disk**: growth per week from `pg_database_size()` plus WAL and backups. Plan expansions months ahead; on RDS, storage autoscaling helps, but shrinking is not possible.
- **Connections**: peak active connections vs pool size and `max_connections`; more app replicas multiply pool sizes. This is where PgBouncer earns its place.
- **CPU and I/O**: headroom at the weekly peak (month-end invoicing runs, not the average Tuesday). Aim to keep the peak below 60 to 70% so a failover, a cold cache or a bad query does not tip you over.
- **Largest tables**: when a table's working set no longer fits in memory, plan partitioning or archiving before it hurts, not after. The scaling-strategies lesson covers those options.

## Common mistakes

- **Turning autovacuum off** because it "uses resources". Bloat and wraparound follow.
- **Global scale factors on huge tables**, so vacuum runs once a month.
- **Ignoring `idle in transaction` sessions** that block cleanup for the whole cluster.
- **`VACUUM FULL` on a hot table in business hours.**
- **No XID age alert** until the warning appears in logs.
- **Alerting on everything**, including cache hit ratio, until the team ignores pages.
- **Forgetting `ANALYZE`** after bulk loads and upgrades.

## In the real world

Most database incidents that look like "Postgres got slow" are maintenance problems: bloat, a blocked vacuum, a stale plan, a full disk, or a lagging replica. Mature teams have a Postgres dashboard per cluster, a small set of paging alerts, a weekly review of `pg_stat_statements`, and per-table autovacuum settings committed as migrations. Mailchimp and Sentry have both published wraparound incident write-ups that are worth reading. In interviews, "explain MVCC and why Postgres needs VACUUM" and "what is transaction ID wraparound" come up often for backend roles.

## Try it

1. Create a 1-million-row table, then run `UPDATE t SET n = n + 1;` three times. Compare `pg_total_relation_size` and `n_dead_tup` before and after.
2. Open a second session with `BEGIN; SELECT 1;` and leave it idle. Run `VACUUM VERBOSE t;` and see dead rows that "cannot be removed yet". Close the transaction and vacuum again.
3. Set `autovacuum_vacuum_scale_factor = 0.01` on the table and watch `last_autovacuum` update after the next round of updates.
4. Start postgres_exporter in Docker against your database and find `pg_up` and `pg_stat_database_blks_hit` in its `/metrics` output.
