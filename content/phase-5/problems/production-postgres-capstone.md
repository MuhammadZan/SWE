## Scenario

Your ERP is growing from 40 to 400 tenants. Enterprise prospects send security questionnaires, the finance team runs month-end reports that slow down everyone else, and last month a migration locked the `invoices` table for two minutes. The company is about to sign an SLA with 99.9% availability, RPO of 5 minutes and RTO of 1 hour.

You are the engineer who makes the database production-ready. Build a reproducible environment that demonstrates every practice from this phase working together, with evidence: a primary and streaming replica behind PgBouncer, least-privilege roles and RLS, a migration pipeline that blocks unsafe DDL, backups with a tested point-in-time restore, monitoring with alerts, a load test, and runbooks.

## Starting point

Use your ERP from earlier phases or a minimal one with at least: `tenants`, `customers`, `products`, `stock_movements`, `invoices`, `invoice_lines`, `payments`. A Node 20+ API (Fastify, Express or Next.js route handlers) with a handful of endpoints: list and create invoices, record a payment, a stock report. Postgres 16 or 17.

## What to build

### 1. Topology (docker compose)

- `pg-primary` and `pg-replica` with streaming replication using a replication slot.
- PgBouncer in transaction pooling mode in front of the primary, and a separate read path to the replica (a second PgBouncer database entry or a second instance).
- The API uses the write pool for writes and read-your-own-write paths, and the read pool for reports. Document which endpoints may tolerate replica lag and why.

### 2. Security

- Roles: owner (`NOLOGIN`), `migrator`, `app` (DML only), `reporting` (read only), `monitor` (`pg_monitor`), `replicator`, and a `BYPASSRLS` role for cross-tenant jobs.
- RLS enabled and forced on all tenant tables, tenant set per transaction with `set_config(..., true)`, working through PgBouncer transaction mode.
- TLS between the API and PgBouncer and between PgBouncer and Postgres, with certificate verification (a local CA is fine).
- Secrets via env files excluded from git, with `.env.example`.

### 3. Zero-downtime migration pipeline

- Migrations as SQL files in the repo, linted with squawk in GitHub Actions; the PR fails on unsafe statements.
- Migration role has `lock_timeout` and `statement_timeout` set; the runner retries on lock timeout.
- Ship at least one realistic change end to end: add a NOT NULL foreign key or rename a column on a table seeded with 1,000,000+ rows, using expand/contract, a batched backfill, `NOT VALID` plus `VALIDATE`, and `CREATE INDEX CONCURRENTLY`, while the load test runs, with zero failed requests.

### 4. Backups and recovery

- pgBackRest or WAL-G with WAL archiving to MinIO, encrypted, scheduled full and incremental or differential backups, retention configured.
- A scripted, repeatable PITR restore into a fresh container, with verification queries. Run it and record measured RPO and RTO against the SLA targets.

### 5. Observability

- postgres_exporter (with the `monitor` role), PgBouncer metrics (pgbouncer_exporter or equivalent), Prometheus and Grafana provisioned from files in the repo.
- A dashboard with: connections by state (Postgres and PgBouncer), transaction rate, longest transaction age, lock waits, replication lag, cache hit ratio, dead tuples on the top tables, XID age, disk usage, and WAL archive status.
- At least six alert rules, including replica lag, connection saturation, long transactions, archiving failures, XID age and disk growth.

### 6. Load test

- k6, autocannon or Artillery scenarios mixing writes and reports, run in three configurations: direct to Postgres with no pooler, through PgBouncer, and through PgBouncer with reports on the replica.
- Report p50/p95/p99 latency, throughput, error rate, and Postgres connection count for each.

### 7. Runbooks

- `runbooks/failover.md`: promoting the replica when the primary dies, repointing PgBouncer, verifying the old primary is fenced, rebuilding a new replica.
- `runbooks/restore.md`: PITR after logical corruption, including finding the target time.
- Execute the failover runbook once and record how long each step took.

## Constraints

- `docker compose up` plus documented scripts bring up the whole stack from a clean clone.
- No component runs as a superuser except where Postgres requires it for setup.
- Every claim in the README links to evidence: a CI run, a screenshot, a results table or a log excerpt.
- Core logic (tenant context helper, read/write routing, backfill job) has automated tests against real Postgres.

## How to measure and verify

The README ends with an evidence table: SLA targets versus measured values (RPO, RTO, failover time, migration-induced errors, p99 under load with and without pooling and the replica), with a link to the proof for each row. Include the architecture diagram you draw in the app.
