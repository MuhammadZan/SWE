## What a strong solution looks like

A strong design treats the three profiles as three different bottlenecks. Profile 1 is **CPU spent recomputing the same aggregates**; Profile 2 is **write I/O, WAL volume and unbounded table growth**; Profile 3 is **noisy-neighbour I/O plus an isolation requirement**. Each gets the cheapest strategy that removes its bottleneck, in an order that ships value early, with numbers that show the arithmetic. It does **not** shard the whole platform: only the whale moves, because of a contract and a measured I/O conflict.

The migration path matters most: each phase is small, reversible, gated on a metric, and leaves the team better off if they stop there.

## Reference approach

### Shared first step: pooling and guardrails (week 1)

Put PgBouncer (or the provider's managed pooler) in transaction mode in front of the primary. Size it from Little's law. Today's peak: 160 tile queries/s x 0.18 s = about 29 busy connections for tiles alone, competing with OLTP on 16 vCPUs. Server pool around 40, client connections unlimited by comparison. Switch tenant context to `SET LOCAL`. Add `statement_timeout = 5s` for the API role and `idle_in_transaction_session_timeout = 30s`. Enable `pg_stat_statements` and `auto_explain` (500 ms) to collect baseline numbers. Rollback: point the connection string back at the primary.

This does not fix CPU; it prevents connection exhaustion and produces the baseline for everything after.

### Profile 1: dashboard rush

Diagnosis: CPU 95% with `wait_event_type` NULL (on CPU) for most active sessions; the 8 tile queries dominate `total_exec_time` during 08:45 to 09:30; per tile, `shared_blks_hit` in the hundreds of thousands. The same tenant's tiles are recomputed by each of its users.

Strategy, in order:

1. **Index check** on the tile queries (cheap, sometimes enough). Likely a partial index for overdue receivables: `(tenant_id, due_date) WHERE status IN ('sent','overdue')`, which serves the one tile that must be read-after-write fresh, from the primary, in a few milliseconds.
2. **Summary tables** for the other tiles: `revenue_daily (tenant_id, day)`, `customer_revenue_monthly (tenant_id, month, customer_id)`, `stock_alerts (tenant_id, sku)`, maintained by an outbox consumer within seconds of each write. Tile queries become index range scans over at most a few hundred rows: target 2 to 5 ms.
3. **Per-tenant tile cache** with a 60 s TTL (cache-aside) so 25 users of one tenant cost one query, not 25.
4. **One read replica** for the remaining dashboard and report reads, with LSN-based read-your-writes for a user's own recent payments.

Numbers after: with an ~80% cache hit rate, 160 tile requests/s become about 32 queries/s at ~4 ms: 0.13 busy connections, well under one core. Writes return to about 8 ms because CPU is no longer saturated. Backfill summary tables per tenant, verify with reconciliation queries, then switch tiles behind a feature flag.

```
 Browser --> API --+--> Redis (tile cache, 60s) 
                   +--> PgBouncer --> Primary  (OLTP + overdue tile, partial index)
                   |                     |  outbox
                   |                     v
                   |               projector worker --> summary tables (on primary)
                   +--> PgBouncer --> Replica   (reports, other reads; LSN check)
```

Not doing: materialized views (a full refresh over 600 million lines exceeds the freshness window) or an OLAP store (overkill for 8 known tiles).

### Profile 2: scan ingestion

Arithmetic first. 5,000 rows/s x 86,400 s = 432 million rows/day. At 300 bytes each, about 130 GB/day; 13 months is about 51 TB. That is the core insight: **raw events at 13-month retention do not belong in the OLTP primary**. Also, 5,000 single-row commits per second, each with 6 index updates and a random UUID v4 primary key insert, is a WAL and random-I/O problem; standby lag follows from the WAL volume.

Strategy:

1. **Buffer and batch.** The API writes events to a durable queue (Kafka/Redpanda, Kinesis, SQS); workers `COPY` batches of 2,000 to 5,000 rows. This cuts per-commit overhead and absorbs 12,000/s bursts in the queue.
2. **Hot table in Postgres, partitioned by day, 14 days retention.** `scan_events` partitioned by `scanned_at` with daily partitions (about 130 GB/day at current indexes; trimmed to 2 indexes plus BRIN on `scanned_at`, roughly 60 to 80 GB/day). Primary key `(scanned_at, id)` with UUID v7 or bigint. Retention is `DETACH ... CONCURRENTLY` plus `DROP`, so autovacuum never has to clean deletes.
3. **Current state table** `pallet_location (tenant_id, pallet_id) PRIMARY KEY` updated by the same worker with an upsert per batch (only the latest event per pallet per batch). Lookups are a primary key read, fresh within the batch interval (under 1 s).
4. **Rollups** `throughput_hourly (tenant_id, warehouse_id, hour)` upserted per batch for the charts.
5. **Raw history to a columnar store or object storage**: the same queue feeds ClickHouse (or Parquet in S3 queried by Athena/DuckDB). Compression of 8 to 15x on this kind of data puts 13 months at roughly 4 to 6 TB, on cheap storage, for the audit requirement.

```
 Scanners --> API --> queue (partitioned by warehouse) --+--> ingest workers --COPY--> Postgres
                                                         |      scan_events (daily partitions, 14d)
                                                         |      pallet_location (upsert latest)
                                                         |      throughput_hourly (upsert)
                                                         +--> ClickHouse / S3 Parquet (13 months raw)
```

Migration: create the partitioned table alongside, dual write, backfill 14 days, switch readers, export the old 1.4 TB table to Parquet, drop it. Success criteria: sustain 12,000 events/s for 10 minutes with standby replay lag under 5 s and pallet lookup freshness under 1 s.

### Profile 3: whale tenant

Diagnosis: at month-end `wait_event_type = 'IO'` dominates, the invoice tables' cache hit ratio falls, and the whale's reports top `shared_blks_read` in `pg_stat_statements`. Its working set evicts small tenants' pages.

Strategy: **move the whale to a dedicated Postgres cluster** (primary, multi-AZ standby for the 99.95% SLA, plus a reporting replica for month-end), paid for by its contract. Small tenants stay on the shared cluster. Add a **tenant directory** (`tenant_id -> cluster`) consulted by the connection layer; this is the same mechanism you would later use to shard, without committing to it.

Move with Postgres 15+ logical replication row filters:

```sql
-- on the shared primary
CREATE PUBLICATION whale_pub FOR TABLE invoices WHERE (tenant_id = 42),
                                   invoice_lines WHERE (tenant_id = 42), ...;
-- on the new cluster (schema created first)
CREATE SUBSCRIPTION whale_sub CONNECTION '...' PUBLICATION whale_pub;
```

Cutover: wait for the initial copy and catch-up, put the whale in read-only mode, wait for zero lag, sync identity sequences (`setval`), flip the directory, re-enable writes. Target under 5 minutes. Keep reverse replication available for a few days as rollback. Then delete the whale's rows from the shared cluster in batches, which frees about 40% of the shared working set.

## Common mistakes

- Proposing read replicas for Profile 2. Replicas replay the same WAL and add no write capacity.
- Storing 13 months of raw events in Postgres without computing the 51 TB.
- Materialized views refreshed every few minutes over hundreds of millions of rows.
- Routing the overdue receivables tile to a replica, breaking read-after-write for payments.
- Migration phases that cannot be rolled back, or that have no success metric.
- No numbers: caching without a hit rate, partitions without a size.

## Trade-offs worth discussing

- **Summary tables in the write transaction vs via outbox.** In-transaction is exact but turns a per-tenant daily row into a hot spot under concurrent writes; the outbox is eventually consistent and decoupled.
- **ClickHouse vs TimescaleDB for raw scans.** Timescale keeps one SQL dialect and Postgres tooling; ClickHouse compresses and scans far better at this volume but is a second operational system.
- **Dedicated cluster vs Citus for the whale.** Citus spreads the whale across nodes but adds distributed-query complexity for everyone; a dedicated cluster is simple and sellable as "isolation".

## Grade yourself

| Dimension | Strong | Acceptable | Needs work |
|---|---|---|---|
| Diagnosis | Names a distinct bottleneck per profile with the exact views and expected values | Correct bottlenecks, little evidence | Treats all three as "database too small" |
| Numbers | Little's law for connections, 432 M rows/day and ~51 TB derived, cache hit and post-change latency estimated | Some arithmetic, gaps | No numbers |
| Strategy fit | Cheapest effective strategy per profile, ordered, with "not doing" triggers | Reasonable strategies, weak ordering | Replicas for writes, global sharding, or MVs over huge tables |
| Diagrams | Three target architectures with data flow direction, sync vs async, and consistency annotations | Diagrams present but ambiguous | Missing or one generic box diagram |
| Migration path | Phased, each with rollback and a success metric, online for large tables | Phased, some rollbacks missing | Big-bang migration |
| Consistency | Read-after-write paths identified and routed to the primary or protected with LSN checks | Mentioned | Ignored |

## Going further

- Benchmark single-row `INSERT`, 1,000-row multi-row `INSERT`, and `COPY` in Docker, and use your measured rows per second to size the number of ingestion workers.
- Write the tenant-directory module with a test that proves a tenant's requests never reach the wrong cluster during and after a cutover.
- Estimate monthly cost per target architecture and check it against the budget.
