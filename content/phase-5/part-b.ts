import type { LessonMeta, ProblemMeta } from "@/lib/types";

export const lessonsB: LessonMeta[] = [
  {
    slug: "zero-downtime-schema-migrations",
    title: "Zero-Downtime Schema Migrations",
    summary:
      "Change a busy Postgres schema without outages by understanding DDL lock levels, failing fast with lock_timeout, building indexes and constraints online, and backfilling in batches behind a CI linter.",
    minutes: 60,
    keyTakeaways: [
      "Most ALTER TABLE forms need an ACCESS EXCLUSIVE lock, and a waiting lock request blocks every query queued behind it; the lock queue, not the DDL, usually causes the outage.",
      "Set lock_timeout (a few seconds) and statement_timeout on the migration role and retry on lock timeout, so a blocked migration fails fast instead of freezing traffic.",
      "Use CREATE INDEX CONCURRENTLY outside a transaction, add foreign keys and checks as NOT VALID then VALIDATE in a separate transaction, and reach SET NOT NULL through a validated CHECK constraint.",
      "Renames and type changes are multi-release expand/contract operations with a sync trigger, a resumable batched backfill throttled on replica lag, and a final contract step.",
      "Lint migrations with squawk in CI, rehearse them on production-sized data, and prefer roll-forward over down migrations once new-shape data exists.",
    ],
    quiz: [
      {
        question:
          "A migration runs ALTER TABLE invoices ADD COLUMN archived_at timestamptz (no default). It is metadata-only, yet the API stalls for four minutes. What is the most likely cause?",
        options: [
          "Adding a column rewrites the whole table",
          "The ALTER waited for ACCESS EXCLUSIVE behind a long-running query, and every later query queued behind the waiting ALTER",
          "Autovacuum started on the table and blocked writes",
          "The new column invalidated every index on the table",
        ],
        answer: 1,
        explanation:
          "Adding a nullable column without a volatile default is instant, but it still needs ACCESS EXCLUSIVE. Lock requests queue in order, so a waiting ALTER blocks all subsequent reads and writes. A short lock_timeout bounds this. Autovacuum takes a lock that does not block normal reads and writes.",
      },
      {
        question:
          "Your migration tool wraps every file in a transaction. You add CREATE INDEX CONCURRENTLY invoices_due_idx ON invoices (due_date) to a migration. What happens?",
        options: [
          "It works, but holds a SHARE lock until commit",
          "It silently builds a non-concurrent index",
          "Postgres raises an error because CREATE INDEX CONCURRENTLY cannot run inside a transaction block",
          "It builds the index on the replica first",
        ],
        answer: 2,
        explanation:
          "CONCURRENTLY cannot run inside a transaction block, so the migration fails. Put it in its own migration with the tool's no-transaction option, and check for INVALID indexes if a concurrent build is interrupted.",
      },
      {
        question:
          "You need a foreign key from invoice_lines (80M rows) to invoices with no write downtime. Which sequence is right?",
        options: [
          "ADD CONSTRAINT ... FOREIGN KEY in one statement during low traffic",
          "ADD CONSTRAINT ... NOT VALID and VALIDATE CONSTRAINT in the same transaction",
          "ADD CONSTRAINT ... NOT VALID in one migration, then VALIDATE CONSTRAINT in a separate transaction",
          "Create a trigger that checks the reference instead of a foreign key",
        ],
        answer: 2,
        explanation:
          "NOT VALID adds the constraint instantly and checks new rows. VALIDATE then scans existing rows under SHARE UPDATE EXCLUSIVE, which allows reads and writes. Doing both in one transaction keeps the stronger lock from the first step during the scan.",
      },
      {
        question:
          "A teammate backfills a new column with UPDATE invoices SET account_id = customer_id on a 50M-row table during business hours. Replicas fall 10 minutes behind and the table doubles in size. What should the backfill have looked like?",
        options: [
          "The same UPDATE, but run with a higher statement_timeout",
          "Keyset-paginated batches of a few thousand rows, each its own short transaction, resumable via a WHERE account_id IS NULL predicate, throttled on replication lag",
          "OFFSET/LIMIT batches inside one transaction so it can roll back atomically",
          "VACUUM FULL first, then the single UPDATE",
        ],
        answer: 1,
        explanation:
          "Small committed batches bound lock duration and WAL bursts, let vacuum reclaim space as you go, and can be restarted safely. One big transaction or OFFSET pagination either holds locks for the whole run or gets slower with every page.",
      },
      {
        question:
          "Release 3 of a column rename drops customer_id. Immediately after the migration, the still-running Release 2 pods start throwing 'column customer_id does not exist' on every invoice query, even though Release 2 reads account_id. Why?",
        options: [
          "Postgres caches dropped columns per connection",
          "The ORM model in Release 2 still mapped customer_id, so it selected it explicitly",
          "The trigger that synced the columns failed",
          "DROP COLUMN rewrites the table and invalidates connections",
        ],
        answer: 1,
        explanation:
          "Many ORMs select every mapped column. If the column is still in the model, dropping it breaks that release. Remove it from the model one release before the drop, so the version running during the contract step never references it.",
      },
    ],
    resources: [
      { label: "PostgreSQL docs: Explicit Locking", url: "https://www.postgresql.org/docs/current/explicit-locking.html", kind: "docs" },
      { label: "PostgreSQL docs: ALTER TABLE", url: "https://www.postgresql.org/docs/current/sql-altertable.html", kind: "docs" },
      { label: "squawk: linter for Postgres migrations", url: "https://github.com/sbdchd/squawk", kind: "web" },
      { label: "node-pg-migrate", url: "https://github.com/salsita/node-pg-migrate", kind: "docs" },
    ],
  },
  {
    slug: "backups-recovery-high-availability",
    title: "Backups, Recovery and High Availability",
    summary:
      "Design Postgres backups, point-in-time recovery, replication and failover around explicit RPO and RTO targets, and prove them with restore drills and runbooks.",
    minutes: 60,
    keyTakeaways: [
      "RPO (data you can lose) and RTO (time to recover) are business targets; design to them and measure them in drills, because an untested backup is a hypothesis.",
      "Replication protects against server loss, not against a bad DELETE; point-in-time recovery from base backups plus archived WAL handles logical mistakes.",
      "Use pgBackRest or WAL-G for compression, encryption, retention and object storage; set archive_timeout so quiet databases do not silently stretch RPO.",
      "Synchronous replication trades commit latency for zero data loss on failover; ANY 1 of two standbys avoids freezing writes when one standby fails.",
      "Failover needs consensus and fencing (Patroni with etcd, or a managed service) to avoid split brain, plus application-side reconnects and routing to the new primary.",
    ],
    quiz: [
      {
        question:
          "A script deletes ten months of invoice_lines at 16:40. You have an async streaming replica in another AZ and nightly pg_dump at 02:00. What gets the data back with the least loss?",
        options: [
          "Promote the replica",
          "Restore the 02:00 dump",
          "Nothing available can do better than the 02:00 dump; you need WAL archiving with point-in-time recovery to restore to 16:39",
          "Run VACUUM to recover the deleted tuples",
        ],
        answer: 2,
        explanation:
          "The replica applied the DELETE within milliseconds, so it has the same loss. The dump loses 14 hours. Only continuous WAL archiving on top of a base backup lets you replay to the moment before the delete. VACUUM removes dead tuples; it never recovers them.",
      },
      {
        question:
          "Your database is mostly idle at night, and archive_timeout is unset. The server's disk dies at 03:10. What is the realistic RPO from the WAL archive?",
        options: [
          "Zero, because WAL is written before data files",
          "Possibly hours: a 16 MB WAL segment is archived only when it fills, so the unarchived partial segment is lost with the server",
          "Exactly one checkpoint interval",
          "Exactly 60 seconds, the default archive_timeout",
        ],
        answer: 1,
        explanation:
          "WAL is archived per completed segment. On a quiet database a segment can take a long time to fill, and archive_timeout defaults to 0 (disabled). Setting it to around 60 seconds forces regular segment switches and bounds archive-based RPO.",
      },
      {
        question:
          "You enable synchronous_standby_names = 'replica1' with a single standby. During maintenance, replica1 is stopped, and every write in the app starts hanging. Why, and what is the usual fix?",
        options: [
          "A bug in Postgres; switch to async",
          "Commits wait for confirmation from a synchronous standby that no longer exists; use ANY 1 (replica1, replica2) with two standbys",
          "The primary entered recovery mode",
          "The replication slot is full; drop it",
        ],
        answer: 1,
        explanation:
          "With synchronous replication, commits wait for the required standby confirmation. With only one candidate, losing it blocks writes. A quorum across two standbys keeps zero-loss commits while tolerating one standby failure.",
      },
      {
        question:
          "A team builds failover with a cron script: if the primary does not answer a ping for 10 seconds, promote the replica. During a brief network partition, both nodes accept writes. What was missing?",
        options: [
          "A shorter ping interval",
          "Consensus on who the leader is plus fencing of the old primary, as Patroni does with a leader key in etcd",
          "Synchronous replication",
          "A larger max_wal_senders",
        ],
        answer: 1,
        explanation:
          "Health checks from one observer cannot tell a dead primary from a partition. Split brain is prevented by a consensus store holding a leader lease, the old primary demoting itself when it loses the lease, and fencing so it cannot accept writes.",
      },
      {
        question:
          "RDS Multi-AZ fails over in about 60 seconds, but your Node API keeps returning errors for 15 minutes afterwards. What is the most likely cause?",
        options: [
          "The standby needs 15 minutes to warm its cache",
          "The API's pool keeps stale connections and cached DNS pointing at the old primary instead of discarding broken connections and re-resolving the endpoint",
          "RDS blocks connections for 15 minutes after a failover",
          "The replica is still replaying WAL",
        ],
        answer: 1,
        explanation:
          "Managed failover flips the endpoint's DNS. Clients that cache DNS or keep broken connections in the pool continue to hit the old host. Short DNS caching, connection validation and retry with backoff make the app follow the failover.",
      },
    ],
    resources: [
      { label: "PostgreSQL docs: Continuous Archiving and PITR", url: "https://www.postgresql.org/docs/current/continuous-archiving.html", kind: "docs" },
      { label: "PostgreSQL docs: High Availability, Load Balancing, and Replication", url: "https://www.postgresql.org/docs/current/high-availability.html", kind: "docs" },
      { label: "pgBackRest", url: "https://pgbackrest.org/", kind: "docs" },
      { label: "Patroni documentation", url: "https://patroni.readthedocs.io/", kind: "docs" },
    ],
  },
  {
    slug: "database-security",
    title: "Database Security",
    summary:
      "Make Postgres enforce least privilege and tenant isolation with separate roles, default privileges and Row-Level Security, and protect data with TLS, encryption, rotation, auditing and safe backups.",
    minutes: 60,
    keyTakeaways: [
      "Separate owner, migrator, app, read-only and monitoring roles; the app never connects as a superuser or table owner, and default privileges keep grants correct for future tables.",
      "Row-Level Security with ENABLE and FORCE, USING and WITH CHECK turns a forgotten tenant filter into zero rows instead of a breach.",
      "Set tenant context with set_config(..., true) inside a transaction; session-level SET leaks across pooled connections, especially behind PgBouncer.",
      "Superusers, BYPASSRLS roles, table owners without FORCE, owner-rights views and SECURITY DEFINER functions all bypass RLS; close or make each one explicit.",
      "Verify TLS certificates, encrypt sensitive columns in the application with KMS-managed keys, rotate credentials with two roles or short-lived tokens, audit with pgaudit, and treat backups as production data.",
    ],
    quiz: [
      {
        question:
          "You enable RLS on invoices with a tenant policy. Tests as the app still return all tenants' rows. The app role created the tables in an early migration. What is wrong?",
        options: [
          "RLS only applies to SELECT statements run inside functions",
          "Table owners bypass RLS unless FORCE ROW LEVEL SECURITY is set; better yet, the app should not own the tables",
          "The policy needs to be created with SECURITY DEFINER",
          "RLS requires a restart to take effect",
        ],
        answer: 1,
        explanation:
          "By default the owner is exempt from RLS. FORCE applies it to the owner too, but the real fix is ownership by a NOLOGIN owner role and an app role with only DML grants and no BYPASSRLS.",
      },
      {
        question:
          "The API sets tenant context with SET app.tenant_id = '...' after acquiring a pooled connection, then runs queries without BEGIN. Occasionally a user sees another tenant's data. Why?",
        options: [
          "SET is not supported for custom settings",
          "Session-level SET persists on the connection after release, so a later request on the same connection can run with the previous tenant's id",
          "Postgres randomly resets custom settings",
          "RLS policies are cached per connection",
        ],
        answer: 1,
        explanation:
          "Pooled connections are reused. Session state survives across requests, and behind PgBouncer in transaction mode it can reach entirely different clients. set_config('app.tenant_id', $1, true) inside an explicit transaction scopes it to that transaction only.",
      },
      {
        question:
          "A reporting view invoice_summary, created by the owner role, joins invoices with RLS enabled. The app role queries the view and sees every tenant. What fixes it on Postgres 15+?",
        options: [
          "GRANT SELECT on the view only to the owner",
          "Recreate the view WITH (security_invoker = true) so it checks permissions and RLS as the calling role",
          "Add ORDER BY tenant_id to the view",
          "Enable RLS on the view itself with ALTER VIEW",
        ],
        answer: 1,
        explanation:
          "Views execute with the view owner's privileges by default, so the owner's RLS exemption applies. security_invoker makes the view evaluate permissions and policies as the querying role.",
      },
      {
        question:
          "You store customer IBANs with pgp_sym_encrypt(iban, 'key-from-env') in SQL. A security review flags it. What is the main concern?",
        options: [
          "pgcrypto is deprecated",
          "The key travels in SQL text and can appear in logs, pg_stat_statements and pg_stat_activity, so anyone with database or log access may recover it",
          "pgp_sym_encrypt produces ciphertext that cannot be decrypted",
          "Encrypted columns cannot be backed up",
        ],
        answer: 1,
        explanation:
          "With database-side encryption the key is visible to the database layer. Application-level envelope encryption with keys in a KMS keeps keys out of the database, and a blind index (HMAC) allows lookups.",
      },
      {
        question:
          "Your API connects with sslmode=require. A pentest still achieves a man-in-the-middle on the database connection. Why?",
        options: [
          "require does not encrypt traffic",
          "require encrypts but does not verify the server certificate; verify-full (or rejectUnauthorized with the provider CA) is needed",
          "TLS cannot be used with connection pools",
          "SCRAM authentication disables TLS",
        ],
        answer: 1,
        explanation:
          "require only ensures encryption, so an attacker presenting any certificate is accepted. verify-full checks the certificate chain against a trusted CA and the hostname.",
      },
    ],
    resources: [
      { label: "PostgreSQL docs: Row Security Policies", url: "https://www.postgresql.org/docs/current/ddl-rowsecurity.html", kind: "docs" },
      { label: "PostgreSQL docs: Privileges", url: "https://www.postgresql.org/docs/current/ddl-priv.html", kind: "docs" },
      { label: "pgAudit", url: "https://www.pgaudit.org/", kind: "docs" },
      { label: "OWASP Query Parameterization Cheat Sheet", url: "https://cheatsheetseries.owasp.org/cheatsheets/Query_Parameterization_Cheat_Sheet.html", kind: "web" },
    ],
  },
  {
    slug: "database-maintenance-monitoring",
    title: "Database Maintenance and Monitoring",
    summary:
      "Keep Postgres healthy for years by understanding MVCC bloat, tuning autovacuum per table, preventing transaction ID wraparound, keeping statistics fresh, and dashboarding and alerting on the metrics that matter.",
    minutes: 55,
    keyTakeaways: [
      "MVCC leaves dead row versions after every UPDATE and DELETE; VACUUM reclaims them, and anything holding an old snapshot (idle transactions, stale slots) blocks cleanup cluster-wide.",
      "Default autovacuum scale factors are too lax for large hot tables; set per-table thresholds as migrations, and use pg_repack rather than VACUUM FULL to fix bloat online.",
      "Transaction ID wraparound forces Postgres to stop writes; monitor age(datfrozenxid) and alert long before it reaches hundreds of millions.",
      "Run ANALYZE after bulk loads and upgrades, raise statistics targets for skewed columns, and rebuild bloated indexes with REINDEX CONCURRENTLY.",
      "Page on connections, replication lag, long transactions, lock waits, archiving failures, disk growth and XID age; keep cache hit ratio and slow queries as dashboard and review signals.",
    ],
    quiz: [
      {
        question:
          "stock_levels has 3 million live rows but takes 41 GB, and n_dead_tup is huge. last_autovacuum shows vacuum runs regularly but removes little. What should you check first?",
        options: [
          "Whether the table needs more indexes",
          "Long-running or idle-in-transaction sessions, stale replication slots or prepared transactions holding back the cleanup horizon",
          "Whether shared_buffers is too small",
          "Whether the table should be converted to UNLOGGED",
        ],
        answer: 1,
        explanation:
          "Vacuum can only remove rows no snapshot can see. An old open transaction anywhere in the cluster prevents cleanup, so vacuum runs but cannot remove dead tuples. Find it in pg_stat_activity and set idle_in_transaction_session_timeout.",
      },
      {
        question:
          "A 200-million-row orders table with default autovacuum settings bloats steadily. Roughly when does autovacuum trigger a vacuum on it?",
        options: [
          "After 50 dead rows",
          "After about 40 million dead rows (50 + 0.2 x 200M)",
          "Every minute, regardless of dead rows",
          "Only when the table is idle",
        ],
        answer: 1,
        explanation:
          "The trigger is threshold plus scale factor times row count. With 0.2 the table must accumulate 20% dead rows first. Set autovacuum_vacuum_scale_factor to around 0.01 or lower on large hot tables.",
      },
      {
        question:
          "The logs show: WARNING: database \"erp\" must be vacuumed within 38000000 transactions. What happens if nothing is done?",
        options: [
          "Queries become slower but nothing else changes",
          "Postgres stops assigning new transaction IDs, effectively refusing writes until a vacuum freezes old rows",
          "Postgres drops the oldest table data",
          "Autovacuum is disabled automatically",
        ],
        answer: 1,
        explanation:
          "This is transaction ID wraparound protection. Postgres refuses new XIDs to prevent old rows from appearing to be in the future. Recovery means a vacuum of the oldest tables, which can take hours on large tables; monitor XID age to never get here.",
      },
      {
        question:
          "After bulk-importing 5 million historical invoices, a report that took 200 ms now takes 3 minutes and EXPLAIN shows a nested loop where the estimated rows are 12 and actual rows are 400,000. What is the quickest correct fix?",
        options: [
          "VACUUM FULL invoices",
          "ANALYZE invoices to refresh planner statistics",
          "Restart Postgres to clear the plan cache",
          "Drop and recreate all indexes",
        ],
        answer: 1,
        explanation:
          "The estimate is wrong because statistics predate the import. ANALYZE refreshes them so the planner picks a suitable join. Run it explicitly after bulk loads rather than waiting for autovacuum.",
      },
      {
        question:
          "Your on-call team gets paged every night by a 'cache hit ratio below 99%' alert, which coincides with the nightly reporting job and never needs action. What is the best change?",
        options: [
          "Lower the threshold to 95%",
          "Move cache hit ratio to a dashboard trend, and page only on signals that need immediate action like connection saturation, replication lag, disk growth, archiving failures and XID age",
          "Disable the reporting job",
          "Increase shared_buffers until the alert stops",
        ],
        answer: 1,
        explanation:
          "Alerts that never need action train people to ignore pages. Cache hit ratio is context-dependent and suits a trend panel. Paging alerts should map to a runbook action.",
      },
    ],
    resources: [
      { label: "PostgreSQL docs: Routine Vacuuming", url: "https://www.postgresql.org/docs/current/routine-vacuuming.html", kind: "docs" },
      { label: "PostgreSQL docs: The Cumulative Statistics System", url: "https://www.postgresql.org/docs/current/monitoring-stats.html", kind: "docs" },
      { label: "postgres_exporter (Prometheus community)", url: "https://github.com/prometheus-community/postgres_exporter", kind: "web" },
      { label: "pg_repack", url: "https://reorg.github.io/pg_repack/", kind: "docs" },
    ],
  },
];

export const problemsB: ProblemMeta[] = [
  {
    slug: "rls-tenant-isolation",
    title: "The Tenant Wall",
    kind: "exercise",
    summary:
      "Add Postgres Row-Level Security to a multi-tenant invoices schema with separate owner and app roles, set tenant context per transaction safely through a pool, and prove with tests that cross-tenant reads and writes fail even without a WHERE clause.",
    estimatedHours: 7,
    needsDiagram: false,
    requirements: [
      "Roles: a NOLOGIN owner, a migrator, an app role with DML only and NOBYPASSRLS, and an explicit BYPASSRLS role for cross-tenant jobs; default privileges make tables from future migrations usable by the app role.",
      "RLS is enabled and forced on customers, invoices and invoice_lines, each with USING and WITH CHECK policies on a transaction-local tenant setting.",
      "With no tenant set, every tenant table returns 0 rows for the app role without raising an error.",
      "invoice_lines carries tenant_id with a composite foreign key to invoices (tenant_id, id), and invoice numbers are unique per tenant rather than globally.",
      "withTenant sets context with set_config(..., true) and a bind parameter inside an explicit transaction; no SQL is built by string concatenation.",
      "Automated tests against real Postgres prove: unfiltered SELECT sees only the current tenant, cross-tenant INSERT/UPDATE/DELETE fail or affect 0 rows, and cross-tenant child rows are rejected.",
      "A pool-leak test with pool size 1 and a concurrency test of 200 interleaved requests across two tenants both pass on 5 consecutive runs.",
      "README includes EXPLAIN (ANALYZE) for a tenant query on 100,000 invoices across 50 tenants showing index use.",
    ],
    hints: [
      "Start by writing the failing test: connect as the app role, insert data for two tenants, run SELECT * FROM invoices with no WHERE, and assert only one tenant's rows come back.",
      "Run migrations with SET ROLE to the owner so tables are owned by it; then ALTER DEFAULT PRIVILEGES FOR ROLE owner applies to every new table.",
      "Wrap current_setting('app.tenant_id', true) in nullif(..., '') and cast to uuid inside a small STABLE function used by every policy.",
      "Foreign keys bypass RLS, so a line could point at another tenant's invoice; a UNIQUE (tenant_id, id) on invoices plus FOREIGN KEY (tenant_id, invoice_id) closes that hole.",
      "For the leak test, create a dedicated Pool with max: 1, run withTenant for tenant A, then query on the same pool with no transaction and assert count = 0.",
    ],
    rubric: [
      "Do all tests connect as the real app role rather than the owner or a superuser?",
      "If I delete the WITH CHECK clause from one policy, does at least one test fail?",
      "If I change set_config's third argument to false, does the leak test fail?",
      "Is every remaining RLS bypass path (owner, BYPASSRLS, views, SECURITY DEFINER) either closed or documented?",
      "Could a new table added next month be forgotten without any check noticing?",
    ],
    stretchGoals: [
      "Run the entire suite through PgBouncer in transaction pooling mode.",
      "Add a CI query that fails if any table with a tenant_id column lacks relrowsecurity and relforcerowsecurity.",
      "Implement the same isolation with Prisma or Drizzle inside interactive transactions and run the same tests.",
    ],
    repoChecklist: [
      "README explaining the role model, policy design, bypass paths and how to run tests",
      "Migration SQL files for roles, schema fixes and policies, rerunnable from an empty database",
      "withTenant helper and repository functions, including the deliberately unfiltered query",
      "Vitest suite running against Postgres via Testcontainers or docker compose",
      "GitHub Actions workflow running the tests on every push",
    ],
    relatedLessons: ["database-security", "data-modeling-for-production", "transactions-isolation-locking"],
  },
  {
    slug: "backup-restore-drill",
    title: "The Restore Drill",
    kind: "exercise",
    summary:
      "Set up WAL archiving to a MinIO bucket with pgBackRest or WAL-G, accidentally drop a table under write load, recover to just before the drop with point-in-time recovery, and measure the real RPO and RTO.",
    estimatedHours: 6,
    needsDiagram: false,
    requirements: [
      "docker compose brings up Postgres 16+, MinIO with a bucket, and pgBackRest or WAL-G with an encrypted repository; the tool's check command passes.",
      "archive_mode is on with an archive_command to the tool and an explicit archive_timeout, all in committed config files.",
      "A write generator inserts at least 50 rows per second and logs each committed batch's max id and commit time as ground truth.",
      "A script drops the table while writes continue and records the incident timestamp in UTC.",
      "Point-in-time recovery restores into a new container to just before the drop, and an automated verification script compares restored rows to the generator log and exits non-zero on mismatch.",
      "The drill runs at least twice with different archive_timeout values, and a README table reports RPO and RTO per run, with RTO broken into provision, restore, WAL replay and verification.",
      "RUNBOOK.md lets someone unfamiliar with the repo perform the recovery, including finding the target time.",
    ],
    hints: [
      "Get archiving verified before anything else: run the tool's check command and look at pg_stat_archiver for archived_count increasing and no failures.",
      "Set log_statement = 'ddl' and a log_line_prefix with %m so the DROP TABLE appears in the log with a millisecond timestamp; that is your recovery target.",
      "Use UTC everywhere: in the generator log, in the incident timestamp and in the recovery target string with an explicit +00 offset.",
      "Restore into a second service with its own empty volume; pgBackRest restore with --type=time, --target and --target-action=promote writes the recovery settings and recovery.signal for you.",
    ],
    rubric: [
      "Did I verify the restored data against independent ground truth rather than by looking at it?",
      "Is my RTO measured from the moment the incident was declared, including finding the target and verifying?",
      "Could a teammate run the drill from a clean clone with only Docker installed?",
      "Are backup repository credentials and the encryption passphrase kept out of git?",
      "Does the runbook explain when to restore aside versus rewind production?",
    ],
    stretchGoals: [
      "Schedule the drill weekly in GitHub Actions and fail the job if RTO regresses by more than 20%.",
      "Add a delayed replica with recovery_min_apply_delay and compare recovery time for the same incident.",
      "Scale the dataset to 20 GB and measure the effect of parallel restore and delta restore on RTO.",
    ],
    repoChecklist: [
      "compose.yaml and all Postgres and backup tool config files, plus .env.example",
      "Scripts for backup, write generation, incident, restore and verification",
      "README with architecture notes and the RPO/RTO results table",
      "RUNBOOK.md for point-in-time recovery after logical corruption",
    ],
    relatedLessons: ["backups-recovery-high-availability", "database-maintenance-monitoring"],
  },
  {
    slug: "production-postgres-capstone",
    title: "The Production-Ready Database",
    kind: "capstone",
    summary:
      "Build a reproducible production-grade Postgres stack for the ERP with a streaming replica, PgBouncer, least-privilege roles and RLS, a linted zero-downtime migration pipeline, tested PITR backups, monitoring with alerts, a load test and runbooks.",
    estimatedHours: 30,
    needsDiagram: true,
    designPrompt:
      "Draw the production topology: API instances; separate write and read paths through PgBouncer (transaction mode) to the primary and the streaming replica; the replication arrow from primary to replica (label async or sync and the slot); WAL archiving and base backups from the primary to the object store (MinIO/S3) and the restore path into a fresh instance; postgres_exporter and PgBouncer exporter feeding Prometheus, Grafana and Alertmanager; the CI pipeline (squawk lint, migrate, tests) applying migrations with the migrator role; and the roles each component uses (app, reporting, migrator, monitor, replicator). Mark TLS-protected links and show where failover moves the primary role.",
    requirements: [
      "docker compose runs a primary, a streaming replica using a replication slot, PgBouncer in transaction mode with separate read-write and read-only entries, and the API, from a clean clone with documented commands.",
      "At least six roles (owner, migrator, app, reporting, monitor, replicator) plus an explicit BYPASSRLS jobs role; RLS forced on all tenant tables and its test suite passes through PgBouncer.",
      "TLS with certificate verification between API and PgBouncer and between PgBouncer and Postgres; no secrets in git.",
      "GitHub Actions lints migrations with squawk and fails on unsafe DDL; a NOT NULL foreign key or rename on a 1,000,000+ row table ships via expand/contract with 0 failed requests during a concurrent load test.",
      "Encrypted pgBackRest or WAL-G backups to MinIO with archive_timeout set; a scripted PITR restore is executed and measured RPO and RTO are within 5 minutes and 1 hour.",
      "Grafana dashboard provisioned from the repo with connections, transaction rate, longest transaction, lock waits, replication lag, cache hit ratio, dead tuples, XID age, disk and archive status, plus at least 6 Prometheus alert rules, one of which is demonstrated firing.",
      "A load test compares direct connections, PgBouncer, and PgBouncer with reports on the replica, reporting p50/p95/p99, throughput, error rate and backend connection count.",
      "Failover and restore runbooks exist, and the failover runbook has been executed with per-step timings recorded.",
    ],
    hints: [
      "Build in layers and commit each working layer: primary plus roles and RLS, then PgBouncer, then replica, then backups, then monitoring, then the load test.",
      "Bootstrap the replica with pg_basebackup -R from an init script so it writes standby.signal and primary_conninfo for you; create the slot on the primary first.",
      "Route only report endpoints to the read pool and keep read-after-write flows such as 'create invoice then show it' on the primary.",
      "Provision Grafana with datasource and dashboard YAML files mounted into the container so the dashboard survives docker compose down -v.",
      "For the migration demo, start the k6 run first, then trigger each migration step and the backfill job, and keep k6's summary and a lock-wait graph as evidence.",
    ],
    rubric: [
      "Does every SLA claim in the README link to evidence I produced, such as a CI run, k6 summary, restore log or screenshot?",
      "Would the stack survive a teammate running docker compose down -v and up again with only the README?",
      "Does any component connect as a superuser when it does not have to?",
      "Have I executed the failover and restore runbooks, not just written them?",
      "Can I explain how each part maps to a managed service such as RDS, Aurora, Cloud SQL, Neon or Supabase?",
    ],
    stretchGoals: [
      "Replace manual failover with Patroni on a three-node etcd cluster and test a network partition.",
      "Add a delayed replica and logical replication of one table into a separate analytics database.",
      "Deploy the design to a managed provider and compare failover time, restore time and monthly cost.",
      "Add a CI job that restores last night's backup and runs smoke tests against it.",
    ],
    repoChecklist: [
      "compose.yaml, Postgres, PgBouncer, backup tool, Prometheus, Alertmanager and Grafana config as files, plus .env.example",
      "migrations/ with the expand/contract sequence and a GitHub Actions workflow with the squawk gate and tests",
      "Tests for the tenant context helper, read/write routing and backfill job against real Postgres",
      "Load test scripts and a results table for the three configurations",
      "runbooks/failover.md and runbooks/restore.md with recorded drill timings",
      "README with the architecture diagram and an SLA evidence table",
    ],
    relatedLessons: [
      "zero-downtime-schema-migrations",
      "backups-recovery-high-availability",
      "database-security",
      "database-maintenance-monitoring",
      "database-scaling-strategies",
      "diagnosing-database-bottlenecks",
    ],
  },
];
