## Why this matters

Phase 3 gave you the scaling ladder in one paragraph: fix queries, cache, scale up, pool, replicas, partition, shard. The hard part in real life is not knowing the rungs. It is knowing **which rung fixes the problem you actually have**. Read replicas do nothing for an ingestion pipeline that saturates WAL writes. Sharding does nothing for a dashboard whose query reads 40 million rows. Partitioning does nothing if every query lacks the partition key. Teams burn quarters on the wrong rung because "we need to scale the database" was never turned into "this resource saturates under this load profile".

This lesson is a decision playbook. You start from the bottleneck you diagnosed (previous lesson) and the shape of the load, and pick the cheapest strategy that removes it, with an honest view of what each one costs to run forever.

## Start with the load profile

| Profile | Shape | Usually saturates |
|---|---|---|
| Read-heavy | 90%+ reads, many users, lists and dashboards | CPU on repeated queries, then I/O as data grows |
| Analytical / reporting | Few queries, each scanning millions of rows | I/O and CPU per query; they hurt OLTP neighbours |
| Write-heavy | Sustained inserts/updates (events, scans, telemetry) | WAL and disk write throughput, index maintenance, autovacuum |
| Spiky | 10x traffic at 09:00, month-end, a marketing email | Connections first, then CPU |
| One whale tenant | One tenant with 40% of data and traffic | Plans tuned for the whale hurt small tenants, and vice versa; that tenant's working set evicts everyone else's |

Measure it, do not guess: reads vs writes from `pg_stat_statements`, rows inserted per second from `pg_stat_user_tables.n_tup_ins` deltas, data size per tenant with a `GROUP BY tenant_id`, and traffic by hour.

## The playbook

| Symptom | Likely bottleneck | Strategies, in order | Cost / complexity |
|---|---|---|---|
| A few queries dominate `total_exec_time` | Bad plans, missing indexes | Index, rewrite, remove N+1, keyset pagination | Low |
| CPU high everywhere, plans already good | Raw compute | Vertical scale; then replicas for reads | Low; medium |
| `too many clients`, pool timeouts, CPU fine | Connections | Right-size pools, PgBouncer / managed pooler | Low |
| Same reads repeated, data changes slowly | Repeated work | Application cache (Phase 3), HTTP caching | Medium (invalidation) |
| Read volume exceeds one box, staleness OK | Read throughput | Read replicas with lag-aware routing | Medium |
| Heavy aggregates on large tables | Per-query I/O | Summary tables, materialized views, CQRS read models | Medium |
| Huge time-series tables, slow deletes, bloat | Table size, vacuum, retention | Range partitioning + drop old partitions | Medium |
| Working set no longer fits in RAM | Memory / I/O | Archive cold data, partition, more RAM | Medium |
| Write throughput / storage exceeds one primary | Write I/O, WAL | Batch writes, fewer indexes, then sharding | High |
| Full-text search, OLAP, high-cardinality metrics | Wrong tool | Search engine, columnar store, time-series DB | High (another system) |

The ordering principle: **cheapest and most reversible first**. An index is a migration you can drop. Sharding is a one-way door that changes every query, migration, backup and on-call runbook.

## Fix queries, then scale vertically

Phase 2 covered query and index work. It still comes first because it is routinely a 10 to 100x win. Vertical scaling comes next because it is underrated: a managed Postgres can go to 64+ vCPUs and 512 GB+ of RAM, many SaaS businesses never outgrow that, and doubling an instance is a one-click change with a short failover. Its limits are cost (roughly linear, sometimes worse), a single point of failure (mitigated by a standby), and a hard ceiling on write throughput.

## Connection pooling and caching

If the diagnosis is connections, pool (previous lesson). If it is repeated identical reads (the same dashboard tiles for the same tenant), caching removes work entirely; Phase 3 covered cache-aside and invalidation. Cache only what you can invalidate correctly or what is fine being stale for a TTL.

## Read replicas

Replicas multiply read capacity. With streaming replication, each replica replays the primary's WAL; on Aurora, replicas share the storage volume and typically lag tens of milliseconds.

Measure lag on the replica:

```sql
SELECT now() - pg_last_xact_replay_timestamp() AS replay_lag;
-- on the primary, per replica:
SELECT application_name, replay_lag FROM pg_stat_replication;
```

(`pg_last_xact_replay_timestamp` overstates lag when the primary is idle, since no new transactions arrive.)

Read-your-writes: Phase 3 used "route the user to the primary for N seconds after a write". A more precise option is LSN-based:

```ts
// after the write, on the primary
const { rows } = await primary.query("SELECT pg_current_wal_lsn()::text AS lsn");
session.minLsn = rows[0].lsn;

// before a read, on the replica
const { rows: r } = await replica.query(
  "SELECT pg_last_wal_replay_lsn() >= $1::pg_lsn AS caught_up", [session.minLsn],
);
const db = r[0].caught_up ? replica : primary;
```

Gotchas: long queries on a replica can be cancelled when replay needs to remove rows they still see (`canceling statement due to conflict with recovery`); tuning `max_standby_streaming_delay` trades lag for fewer cancellations, and `hot_standby_feedback = on` trades it for bloat on the primary. Never make a correctness decision (stock, balance, uniqueness) from a replica.

## Materialized views, summary tables, CQRS read models

When the dashboard query must aggregate 40 million rows, make the answer exist before anyone asks.

```sql
CREATE MATERIALIZED VIEW mv_revenue_by_day AS
SELECT tenant_id, (paid_at AT TIME ZONE 'UTC')::date AS day,
       sum(total_cents) AS revenue_cents, count(*) AS invoices
FROM invoices WHERE status = 'paid'
GROUP BY 1, 2;

CREATE UNIQUE INDEX ON mv_revenue_by_day (tenant_id, day);  -- required for CONCURRENTLY
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_revenue_by_day;   -- readers not blocked
```

A materialized view recomputes **everything** on every refresh. Once that takes too long, switch to an incrementally maintained summary table:

```sql
INSERT INTO revenue_daily (tenant_id, day, revenue_cents, invoices)
VALUES ($1, $2, $3, 1)
ON CONFLICT (tenant_id, day)
DO UPDATE SET revenue_cents = revenue_daily.revenue_cents + EXCLUDED.revenue_cents,
              invoices      = revenue_daily.invoices + 1;
```

Done in the write transaction it is exact (but a hot row per tenant per day can become a contention point); done from a queue it is eventually consistent and decoupled. The general form is **CQRS read models**: the write side emits events (via an outbox), and consumers maintain query-shaped tables, possibly in another database. Price: two models to keep consistent, and a rebuild procedure when the projection logic changes.

## Table partitioning

Partitioning splits one logical table into child tables by a key. It is about **manageability and pruning**, not magically faster indexes.

```sql
CREATE TABLE scan_events (
  id          bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id   bigint NOT NULL,
  scanned_at  timestamptz NOT NULL,
  device_id   bigint NOT NULL,
  payload     jsonb,
  PRIMARY KEY (scanned_at, id)          -- must include the partition key
) PARTITION BY RANGE (scanned_at);

CREATE TABLE scan_events_2026_11 PARTITION OF scan_events
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');

-- Retention: instant, no DELETE, no bloat
ALTER TABLE scan_events DETACH PARTITION scan_events_2026_05 CONCURRENTLY;
DROP TABLE scan_events_2026_05;
```

- **Range** (by time): logs, events, ledgers. Retention by dropping partitions; old partitions can be made read-only, archived, or given cheaper indexes (BRIN).
- **List** (by region, status, or a few big tenants): isolate a whale into its own partition.
- **Hash** (by `tenant_id`): spreads write and vacuum load evenly; does not help retention.

**Partition pruning** is the payoff: a query with `WHERE scanned_at >= now() - interval '1 day'` touches only the current partition. A query without the partition key in `WHERE` scans every partition and gets *slower*. Other costs: unique constraints must include the partition key (no global uniqueness on `id` alone), thousands of partitions slow planning, and someone must create future partitions (`pg_partman` or a scheduled job). Plan before you need it; converting a 2 TB table into a partitioned one is an online migration project.

## Archiving cold data

Most ERP data is cold after a year or two but must be kept for 7 to 10 years for audit. Moving it out of the hot tables shrinks indexes and the working set. Options: move to an `*_archive` table or schema on cheaper storage, detach old partitions and keep them as plain tables, or export to Parquet in object storage and query with an analytics engine. Keep a defined path for "show me an invoice from 2019".

## Sharding

When one primary cannot absorb the writes or hold the data, split data across multiple Postgres clusters. For B2B SaaS the shard key is almost always `tenant_id`, because nearly every query is already tenant-scoped.

```
              +----------------------+
 request ---> | router: tenant->shard |  (lookup table, cached)
              +----------------------+
               /          |          \
         shard 1       shard 2      shard 3     each: primary + replica
         tenants...    tenants...   whale tenant alone
```

Use a **directory** (lookup table) rather than `hash(tenant_id) % N`: it lets you place a whale on its own shard and move tenants without rehashing everyone. What you give up: cross-shard joins and transactions (platform-wide reports go to an analytics store), global unique IDs from a single sequence (use UUID v7 or per-shard ranges), and simple migrations (run on every shard, tolerate partial failure). **Rebalancing** means copying a tenant's rows to another shard (logical replication filtered by tenant, or dump/restore), briefly freezing that tenant's writes, flipping the directory, and cleaning up.

**Citus** (an extension, also available as Azure Cosmos DB for PostgreSQL) does much of this inside Postgres: `create_distributed_table('invoices', 'tenant_id')` spreads rows across worker nodes, co-locates tables with the same distribution column so tenant-scoped joins stay local, and replicates small shared tables with `create_reference_table`. It still requires `tenant_id` in your keys and queries. Other routes: Vitess/PlanetScale for MySQL, Aurora Limitless, or application-level routing.

## Specialized stores

Postgres is excellent at many things and best at none of these at large scale:

- **Search** (fuzzy, relevance, facets over millions of documents): OpenSearch/Elasticsearch, Typesense, Meilisearch. Postgres `tsvector` and `pg_trgm` are fine until relevance tuning and scale demand more.
- **Analytics / OLAP** (scan billions of rows, aggregate a few columns): columnar stores like ClickHouse, BigQuery, Snowflake, DuckDB. Columnar compression and vectorized execution make 100x differences on these queries.
- **Time-series** (high ingest, rollups, retention): TimescaleDB (a Postgres extension with automatic partitioning and compression) or ClickHouse.

The cost is a second system: a pipeline to feed it (CDC with Debezium, logical replication, or outbox consumers), lag, a second schema, and an on-call surface.

## Profiles mapped to plans

- **Read-heavy with peaks**: indexes, pooler, cache hot tiles, summary tables for dashboards, one or two replicas with read-your-writes routing. Scale up before 09:00 if your platform allows scheduled scaling.
- **Write-heavy ingestion**: batch inserts (multi-row `INSERT` or `COPY`, 500 to 5,000 rows per statement), minimal indexes (BRIN on time), time partitioning with partition drops for retention, rollups into summary tables, a queue in front to absorb bursts. Consider TimescaleDB or ClickHouse for the raw events. Replicas do not help writes.
- **Spiky**: poolers and pool caps first, so the spike queues instead of exhausting connections; cache; pre-scale on known schedules; load-shed non-critical work to queues.
- **One whale tenant**: isolate it. Partition by list on `tenant_id` or move the tenant to its own database or shard; give its heavy reports their own replica; watch for plans skewed by its data. The planner knows the whale is frequent (most-common-value statistics on `tenant_id`), but distributions of other columns *within* a tenant are averaged across all tenants, and a cached generic plan for a prepared statement may suit small tenants and not the whale. Test plans with the whale's parameters and consider `CREATE STATISTICS` for correlated columns.

## Common mistakes

- Adding read replicas for a write-bound system.
- Partitioning without the partition key in the hot queries, making them slower.
- Sharding by hash and discovering that moving one whale means moving everyone.
- Reaching for sharding before measuring whether a bigger instance, archiving, and summary tables were enough.
- Materialized views refreshed every minute that take 70 seconds to refresh.
- Reading from replicas right after a write, then "fixing" the bug with `sleep(1000)`.
- Adding Elasticsearch or ClickHouse without a plan for keeping it in sync or rebuilding it.

## In the real world

Most B2B SaaS companies run on one well-tuned primary, a standby, one or two read replicas, a pooler, summary tables, and time-partitioned event tables, for a surprisingly long time. Companies that shard usually do it by tenant, often moving their largest customers first. Analytics leaves Postgres earlier than OLTP does. In system design interviews, the strongest answers state the load numbers, name the bottleneck, and pick the cheapest strategy that fixes it, with a path to the next rung when the numbers grow.

## Try it

Take an application you know and write its load profile in one table: reads per second, writes per second, data size, growth per month, largest tenant's share, and peak-to-average ratio. Run the diagnostic queries from the previous lesson on a staging copy. Then write three lines: the current bottleneck, the next strategy from the playbook, and the metric that would tell you to move to the rung after that.
