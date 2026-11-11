import type { LessonMeta, ProblemMeta } from "@/lib/types";

export const lessonsA: LessonMeta[] = [
  {
    slug: "data-modeling-for-production",
    title: "Data Modeling for Production",
    summary:
      "Design schemas that stay correct for years: practical normalization, deliberate denormalization, multi-tenant isolation, constraints as business rules, and the right types and keys.",
    minutes: 40,
    keyTakeaways: [
      "Normalize so one real-world fact lives in one place, but snapshot values that must be frozen in time, such as the address and prices on an issued invoice.",
      "Denormalize only for a measured read problem, with a single writer and a reconciliation query that proves the copy matches its source.",
      "Shared tables with tenant_id are the SaaS default; composite foreign keys on (tenant_id, id) make cross-tenant references impossible, and RLS is a safety net.",
      "Invariants belong in the schema: CHECK, UNIQUE, composite FKs and exclusion constraints hold under races, backfills and second services where API validation does not.",
      "Use bigint minor units or numeric for money, timestamptz for instants and date for business dates; soft delete needs partial unique indexes and a purge plan.",
      "UUID v4 primary keys scatter inserts across the index; UUID v7 (built in from Postgres 18) or bigint identity keep inserts local.",
    ],
    quiz: [
      {
        question:
          "A customer changes their billing address. Finance complains that re-printing an invoice issued last year now shows the new address. What is the right modeling fix?",
        options: [
          "Store a snapshot of the billing address on the invoice when it is issued",
          "Add an index on customers.address so the join is faster",
          "Forbid customers from changing their address once they have invoices",
          "Join to an audit_log table at render time to reconstruct the old address",
        ],
        answer: 0,
        explanation:
          "An issued invoice is a legal document whose contents must not change. Copying the address at issue time is a deliberate snapshot, not accidental denormalization. Forbidding address changes is unreasonable, an index does not change semantics, and reconstructing from an audit log is fragile and slow.",
      },
      {
        question:
          "In a shared-table multi-tenant schema, a bug in a bulk import created invoices for tenant 7 that reference customers belonging to tenant 12. Which schema change would have made this impossible?",
        options: [
          "A CHECK constraint that tenant_id > 0",
          "An index on invoices (tenant_id, customer_id)",
          "A composite foreign key from invoices (tenant_id, customer_id) to customers (tenant_id, id)",
          "A single-column foreign key from invoices.customer_id to customers.id",
        ],
        answer: 2,
        explanation:
          "A single-column FK only checks that the customer exists somewhere. The composite FK requires the referenced customer to have the same tenant_id, so a cross-tenant reference fails at insert. An index or a CHECK on tenant_id does not relate the two tables.",
      },
      {
        question:
          "Your meeting-room booking code checks for overlapping bookings with a SELECT before INSERT. Under load, overlapping bookings still appear. Which Postgres feature enforces the rule regardless of concurrency?",
        options: [
          "A UNIQUE constraint on (room_id, starts_at)",
          "An exclusion constraint using GiST: EXCLUDE (room_id WITH =, during WITH &&)",
          "A trigger that runs the same SELECT before insert",
          "Running the SELECT and INSERT in a READ COMMITTED transaction",
        ],
        answer: 1,
        explanation:
          "An exclusion constraint rejects any pair of rows whose ranges overlap for the same room, enforced by the index even for concurrent inserts (SQLSTATE 23P01). UNIQUE only catches identical start times. A trigger running a SELECT has the same race as the application code, and Read Committed does not prevent it.",
      },
      {
        question:
          "After adding deleted_at to customers, a user deletes a customer with email ops@acme.com and then cannot recreate it: 'duplicate key value violates unique constraint'. What is the correct fix?",
        options: [
          "Drop the unique constraint on email",
          "Replace it with a unique index on (tenant_id, lower(email)) WHERE deleted_at IS NULL",
          "Append a random suffix to the email of deleted customers",
          "Hard delete customers instead and accept that their invoices become orphans",
        ],
        answer: 1,
        explanation:
          "A partial unique index enforces uniqueness only among live rows, which is the business rule. Dropping the constraint allows real duplicates. Mangling emails corrupts data. Hard deletes with orphaned invoices break referential integrity and legal retention.",
      },
      {
        question:
          "A 2-billion-row scan_events table uses a random UUID v4 primary key. Insert throughput has steadily dropped as the table grew, and disk reads during inserts are high. Which change addresses the cause?",
        options: [
          "Switch to UUID v7 or a bigint identity so new keys land near the right edge of the index",
          "Add a second index on the UUID to spread the load",
          "Change the column type from uuid to text",
          "Increase max_connections so more inserts run in parallel",
        ],
        answer: 0,
        explanation:
          "Random keys insert into random leaf pages of the primary key B-tree; once the index exceeds memory, each insert needs random reads and causes page splits. Time-ordered UUID v7 or sequential bigint keys append near the same pages, which stay cached. More indexes, text keys or more connections make it worse.",
      },
    ],
    resources: [
      {
        label: "PostgreSQL docs: Constraints",
        url: "https://www.postgresql.org/docs/current/ddl-constraints.html",
        kind: "docs",
      },
      {
        label: "PostgreSQL docs: Row Security Policies",
        url: "https://www.postgresql.org/docs/current/ddl-rowsecurity.html",
        kind: "docs",
      },
      {
        label: "Designing Data-Intensive Applications (Martin Kleppmann)",
        url: "https://dataintensive.net/",
        kind: "book",
      },
    ],
  },
  {
    slug: "transactions-isolation-locking",
    title: "Transactions, Isolation Levels and Locking",
    summary:
      "Understand what each Postgres isolation level allows, how MVCC implements it, and which lock, constraint or retry pattern closes each concurrency anomaly.",
    minutes: 45,
    keyTakeaways: [
      "Read Committed takes a new snapshot per statement; Repeatable Read and Serializable use one snapshot per transaction and raise 40001 on conflicting updates.",
      "Lost updates come from read-modify-write in application code; fix with an atomic UPDATE, SELECT FOR UPDATE, or optimistic versioning.",
      "Write skew happens when transactions read an overlapping set and write different rows; only Serializable, a materialized conflict row, or a constraint prevents it.",
      "Deadlocks come from inconsistent lock order; sort keys before locking and still treat 40P01 as retryable.",
      "Serializable means retries are part of the contract: re-run the whole transaction body, with no non-idempotent side effects inside.",
      "Keep transactions short: long or idle-in-transaction sessions hold locks, block migrations and stop vacuum from cleaning dead rows.",
    ],
    quiz: [
      {
        question:
          "Two managers approve expenses at the same moment. Each transaction sums approved expenses for the department, sees room in the budget, and marks a different expense as approved. Both run at REPEATABLE READ and both commit, exceeding the budget. What anomaly is this, and what fixes it?",
        options: [
          "A dirty read; switching to READ COMMITTED fixes it",
          "A lost update; an atomic UPDATE fixes it",
          "A deadlock; consistent lock ordering fixes it",
          "Write skew; SERIALIZABLE with retries, or locking the shared budget row first, fixes it",
        ],
        answer: 3,
        explanation:
          "Each transaction read the same set and wrote a different row, so no row-level conflict occurred and Repeatable Read allowed both. Serializable detects the read/write dependency cycle and aborts one; locking the budget row FOR UPDATE at Read Committed forces the second transaction to wait and re-read. Postgres never allows dirty reads.",
      },
      {
        question:
          "A stock adjustment reads on_hand, computes the new value in TypeScript, and writes it back. You move the code to REPEATABLE READ. Under concurrency, what now happens instead of a silent lost update?",
        options: [
          "Both writes succeed and the result is still wrong",
          "The second transaction's UPDATE fails with SQLSTATE 40001 and must be retried",
          "The second transaction blocks forever",
          "Postgres merges both updates automatically",
        ],
        answer: 1,
        explanation:
          "At Repeatable Read, updating a row that another transaction changed after your snapshot raises 'could not serialize access due to concurrent update' (40001). The application must retry the whole transaction, which will then read the new value. Postgres never merges application-computed values.",
      },
      {
        question:
          "Order allocation updates stock rows in the order the customer added items. At month-end you see intermittent 'deadlock detected' errors. What is the primary fix?",
        options: [
          "Increase deadlock_timeout to 30 seconds",
          "Switch the transaction to SERIALIZABLE",
          "Sort lines by product_id before updating, or lock all rows up front with ORDER BY product_id FOR UPDATE",
          "Use SKIP LOCKED on the stock updates",
        ],
        answer: 2,
        explanation:
          "Deadlocks arise when two transactions acquire the same locks in opposite orders. A consistent order means the second transaction waits instead of forming a cycle. A longer timeout only delays detection, Serializable does not prevent lock-order deadlocks, and SKIP LOCKED would silently skip stock rows.",
      },
      {
        question:
          "A ten-worker export system must make sure each queued job is processed by exactly one worker, without workers waiting on each other. Which query pattern fits?",
        options: [
          "SELECT ... FOR UPDATE SKIP LOCKED with LIMIT, then mark the claimed rows as running",
          "SELECT ... FOR UPDATE NOWAIT and retry on error",
          "SELECT the oldest job without locks and update it if still queued",
          "A session-level advisory lock per worker",
        ],
        answer: 0,
        explanation:
          "SKIP LOCKED lets each worker claim rows no other worker holds, without blocking. NOWAIT makes workers fail and retry on contention, wasting work. An unlocked SELECT lets two workers claim the same job. A per-worker advisory lock does not coordinate which job each takes.",
      },
      {
        question:
          "You wrap a payment flow in a SERIALIZABLE transaction with a retry loop. Inside it, the code sends a confirmation email after inserting the payment. What is the problem?",
        options: [
          "Emails cannot be sent from inside a database transaction",
          "Serializable transactions cannot insert rows",
          "The retry loop should only retry the INSERT, not the whole function",
          "On a 40001 retry the email can be sent twice, and the transaction is held open during a slow network call",
        ],
        answer: 3,
        explanation:
          "A retry re-runs the whole body, so non-idempotent side effects repeat; and a network call inside the transaction keeps locks and the snapshot open. Record the intent in an outbox row in the same transaction and send the email afterwards. Retrying only one statement would act on stale reads.",
      },
    ],
    resources: [
      {
        label: "PostgreSQL docs: Transaction Isolation",
        url: "https://www.postgresql.org/docs/current/transaction-iso.html",
        kind: "docs",
      },
      {
        label: "PostgreSQL docs: Explicit Locking",
        url: "https://www.postgresql.org/docs/current/explicit-locking.html",
        kind: "docs",
      },
      {
        label: "Jepsen: Consistency Models",
        url: "https://jepsen.io/consistency",
        kind: "web",
      },
      {
        label: "Designing Data-Intensive Applications (Martin Kleppmann)",
        url: "https://dataintensive.net/",
        kind: "book",
      },
    ],
  },
  {
    slug: "diagnosing-database-bottlenecks",
    title: "Diagnosing Database Bottlenecks",
    summary:
      "A repeatable method to find which resource a live Postgres is short of, the queries consuming it, and how connection pooling changes the picture.",
    minutes: 45,
    keyTakeaways: [
      "Identify the saturated resource first (CPU, I/O, memory, locks, connections, round trips) before changing anything; each has a different fix.",
      "pg_stat_activity and wait events show what sessions are doing right now; pg_blocking_pids finds the root blocker of a lock pile-up.",
      "pg_stat_statements ranked by total_exec_time shows where the database spends its life, which is often a fast query called millions of times.",
      "Size pools with Little's law (busy connections = throughput x time in DB) and make the sum of all app pools fit under max_connections.",
      "PgBouncer in transaction mode multiplexes thousands of clients onto few server connections but breaks session state: use SET LOCAL, xact advisory locks, and direct connections for migrations.",
    ],
    quiz: [
      {
        question:
          "At 09:00 the API is slow. Database CPU is 25%, disk I/O is normal, and pg_stat_activity shows 300 active sessions with wait_event_type = 'Lock'. What is the best next step?",
        options: [
          "Double the instance size",
          "Add indexes to the most frequent queries",
          "Raise max_connections",
          "Use pg_blocking_pids to find the root blocker and what it is doing",
        ],
        answer: 3,
        explanation:
          "Low CPU and I/O with many sessions waiting on locks means contention, not capacity. Find the root blocker (often an idle-in-transaction session or a migration waiting for an exclusive lock) and resolve it. A bigger instance, more connections or new indexes do not release a lock.",
      },
      {
        question:
          "pg_stat_statements shows a monthly report with mean_exec_time 9 s and 30 calls, and a product lookup with mean 1.5 ms and 40 million calls. CPU is the bottleneck. Which should you optimize first?",
        options: [
          "The product lookup, because it accounts for about 60,000 s of total time versus about 270 s",
          "The report, because 9 s is the slowest query",
          "Neither; reset pg_stat_statements and wait",
          "Both equally, since they have the same total effect",
        ],
        answer: 0,
        explanation:
          "For throughput and CPU, total_exec_time is what matters: 40 million x 1.5 ms is about 60,000 seconds versus 30 x 9 s = 270 seconds. Shaving even 0.5 ms from the lookup saves far more than fixing the report. The report still matters for its users' latency, but not for CPU saturation.",
      },
      {
        question:
          "Your API handles 2,400 queries per second with an average of 5 ms in the database. The team proposes a pool of 50 connections per instance across 12 instances. What does Little's law suggest?",
        options: [
          "600 connections are needed, so the plan is too small",
          "About 12 connections are busy at any instant, so 600 is far too many and will hurt under load",
          "Exactly 50, one per instance per core",
          "Little's law does not apply to databases",
        ],
        answer: 1,
        explanation:
          "Busy connections = 2,400 q/s x 0.005 s = 12. A total of 600 connections would exceed typical max_connections and add contention when they all become active during a spike. Size small pools per instance, or put a pooler in front so the server side stays around a small multiple of CPU cores.",
      },
      {
        question:
          "After introducing PgBouncer in transaction mode, a support engineer sees another tenant's data in one request. The app runs SET app.tenant_id = '42' at the start of each request, and RLS policies read that setting. What went wrong?",
        options: [
          "RLS does not work with PgBouncer at all",
          "PgBouncer caches query results across clients",
          "SET is session-scoped, so the setting stayed on a server connection later reused by another client; use SET LOCAL inside the transaction",
          "The tenant_id should be passed as a query comment",
        ],
        answer: 2,
        explanation:
          "In transaction mode, server connections are reassigned between transactions. A session-level SET survives on that connection and leaks to the next client. SET LOCAL (or set_config with is_local = true) scopes the value to the transaction. PgBouncer does not cache results, and RLS works fine with transaction-scoped settings.",
      },
      {
        question:
          "A Next.js app on serverless functions works fine until a marketing email goes out; then Postgres logs 'sorry, too many clients already' while CPU stays at 30%. What is the most appropriate fix?",
        options: [
          "Upgrade to an instance with more vCPUs",
          "Connect through a transaction-mode pooler endpoint and limit each function instance's pool to 1 or 2 connections",
          "Add a read replica",
          "Increase work_mem",
        ],
        answer: 1,
        explanation:
          "Each function instance opens its own connections, so a spike to hundreds of instances exhausts max_connections even though query load is modest. A pooler multiplexes them onto a small server pool. CPU, replicas and work_mem do not address connection count.",
      },
    ],
    resources: [
      {
        label: "PostgreSQL docs: The Cumulative Statistics System (pg_stat_activity, wait events)",
        url: "https://www.postgresql.org/docs/current/monitoring-stats.html",
        kind: "docs",
      },
      {
        label: "PostgreSQL docs: pg_stat_statements",
        url: "https://www.postgresql.org/docs/current/pgstatstatements.html",
        kind: "docs",
      },
      {
        label: "PgBouncer documentation",
        url: "https://www.pgbouncer.org/",
        kind: "docs",
      },
      {
        label: "PostgreSQL docs: auto_explain",
        url: "https://www.postgresql.org/docs/current/auto-explain.html",
        kind: "docs",
      },
    ],
  },
  {
    slug: "database-scaling-strategies",
    title: "Database Scaling Strategies: A Decision Playbook",
    summary:
      "Match the load profile and the diagnosed bottleneck to the cheapest effective strategy, from query fixes through replicas, summary tables, partitioning and sharding to specialized stores.",
    minutes: 45,
    keyTakeaways: [
      "Start from the load profile (read-heavy, write-heavy, spiky, one whale tenant) and the saturated resource; each strategy fixes specific bottlenecks only.",
      "Apply the cheapest, most reversible strategy first: queries and indexes, vertical scaling, pooling, caching, then replicas.",
      "Read replicas add read capacity but not write capacity, and need lag-aware routing (time or LSN based) for read-your-writes.",
      "Summary tables and CQRS read models precompute heavy aggregates; materialized views recompute everything on each refresh.",
      "Partitioning gives pruning and instant retention only when queries include the partition key; sharding by tenant with a directory is the last, one-way rung.",
      "Search, OLAP and high-volume time-series often belong in specialized stores fed by CDC or an outbox, at the cost of a second system.",
    ],
    quiz: [
      {
        question:
          "An IoT ingestion service inserts 8,000 rows per second and the primary's disk write throughput is saturated. A colleague proposes adding two read replicas. What is wrong with this?",
        options: [
          "Replicas replay the same WAL and add no write capacity; batching, fewer indexes and partitioning address the write bottleneck",
          "Nothing; replicas share write load automatically",
          "Replicas are only supported on Aurora",
          "Replicas would cause deadlocks with the primary",
        ],
        answer: 0,
        explanation:
          "Every write still happens on the primary, and each replica must apply the same changes. Write-bound systems are helped by batching (multi-row INSERT or COPY), trimming indexes, time partitioning with partition drops, and eventually sharding.",
      },
      {
        question:
          "You partition a 1 TB invoices table by month on issued_at. Afterwards, the customer detail page, which filters only by tenant_id and customer_id, is slower. Why?",
        options: [
          "Partitioned tables cannot have indexes",
          "The query lacks the partition key, so Postgres cannot prune and must probe every partition's index",
          "Partitioning disables the query planner's statistics",
          "Monthly partitions always use sequential scans",
        ],
        answer: 1,
        explanation:
          "Partition pruning needs the partition key in the WHERE clause. Without issued_at, the query visits an index in each of dozens of partitions instead of one. Partitioning helps queries and maintenance aligned with the key, and can hurt the rest.",
      },
      {
        question:
          "A dashboard tile aggregates 300 million invoice lines. You make it a materialized view refreshed every 5 minutes, but REFRESH takes 7 minutes and load stays high. What is the better design?",
        options: [
          "Refresh the materialized view every minute instead",
          "Move the materialized view to a read replica",
          "An incrementally maintained summary table updated by upsert on each write or from an outbox consumer",
          "Add more indexes to the materialized view",
        ],
        answer: 2,
        explanation:
          "A materialized view recomputes the full result on every refresh, so its cost grows with total data. An incremental summary table only applies each change, keeping cost proportional to write volume. More frequent refreshes or indexes on the view do not reduce refresh cost.",
      },
      {
        question:
          "One tenant holds 40% of the data in a shared multi-tenant database and its month-end reports degrade every other tenant. It is also asking for contractual isolation. What is a proportionate approach?",
        options: [
          "Hash-shard every tenant across 8 databases",
          "Add a global Redis cache in front of all queries",
          "Raise shared_buffers until the whale fits in memory",
          "Move that tenant to a dedicated Postgres cluster, routed through a tenant-to-cluster directory, with its own reporting replica",
        ],
        answer: 3,
        explanation:
          "Isolating the one outlier solves both the noisy-neighbour I/O and the isolation requirement, and the directory is reusable if you later shard. Hash-sharding everyone is a large one-way change for a single-tenant problem, and caching or memory tuning does not provide isolation.",
      },
      {
        question:
          "After moving reads to a replica, users report that a payment they just recorded is missing from the list they are redirected to. What is the most robust fix?",
        options: [
          "Add a 1 second sleep before redirecting",
          "Record the primary's WAL LSN after the write and read from the replica only once it has replayed past that LSN, otherwise read from the primary",
          "Turn off replication lag monitoring",
          "Move all reads back to the primary permanently",
        ],
        answer: 1,
        explanation:
          "LSN-based read-your-writes guarantees the replica includes the user's write, falling back to the primary when it does not. Sleeping is a guess that fails under load, and moving all reads back throws away the replica's capacity.",
      },
    ],
    resources: [
      {
        label: "PostgreSQL docs: Table Partitioning",
        url: "https://www.postgresql.org/docs/current/ddl-partitioning.html",
        kind: "docs",
      },
      {
        label: "PostgreSQL docs: High Availability, Load Balancing, and Replication",
        url: "https://www.postgresql.org/docs/current/high-availability.html",
        kind: "docs",
      },
      {
        label: "Citus documentation",
        url: "https://docs.citusdata.com/",
        kind: "docs",
      },
      {
        label: "Designing Data-Intensive Applications (Martin Kleppmann)",
        url: "https://dataintensive.net/",
        kind: "book",
      },
    ],
  },
];

export const problemsA: ProblemMeta[] = [
  {
    slug: "isolation-anomaly-lab",
    title: "Isolation Anomaly Lab",
    kind: "exercise",
    summary:
      "Reproduce a lost update, write skew and a deadlock deterministically with two real Postgres sessions driven from TypeScript tests, then prove the correct fix for each.",
    estimatedHours: 8,
    needsDiagram: false,
    requirements: [
      "Postgres 16+ runs in Docker with deadlock_timeout=100ms, and every test resets the stock, budgets and expenses tables to a known state before running.",
      "Each session is a dedicated pg Client; ordering is controlled only by awaited steps and a waitUntilBlocked helper that polls pg_stat_activity for wait_event_type = 'Lock' (no sleeps for ordering).",
      "Lost update: the bug test asserts final on_hand = 6 from a start of 10 with picks of 3 and 4; the atomic UPDATE and FOR UPDATE fix tests assert 3; a REPEATABLE READ test asserts SQLSTATE 40001.",
      "Write skew: with a 100000-cent budget and 70000 approved, the REPEATABLE READ bug test asserts 110000 approved and no errors; the SERIALIZABLE + retry and budget-row FOR UPDATE fix tests each assert 90000.",
      "Deadlock: the bug test asserts exactly one of two sessions fails with SQLSTATE 40P01; the sorted-lock-order fix test asserts both commit and the final stock is correct.",
      "A withTx retry helper retries the whole body on 40001 and 40P01 with jittered backoff, stops after maxAttempts, does not retry 23505, and has unit tests for all three behaviours.",
      "The full suite passes 20 consecutive runs, and each test file runs in under 5 seconds.",
    ],
    hints: [
      "Start with the harness: three clients (A, B and an observer), a pid() helper, and waitUntilBlocked. Make the FOR UPDATE test pass first, because it exercises blocking.",
      "To start a statement that will block, call client.query without await, keep the promise, confirm the session is waiting with the observer, then release the blocker and await the promise.",
      "For write skew, both sessions must read the sum before either writes. Make each update a different pending expense, so no row lock conflict exists.",
      "Under SERIALIZABLE, the 40001 may come from the second UPDATE or from COMMIT. Wrap both in a try and assert that exactly one session failed somewhere.",
      "For the deadlock, start A's second update without await, wait until A is blocked, then run B's second update; use Promise.allSettled and count rejections with code 40P01.",
    ],
    rubric: [
      "Would every bug test fail if I applied the fix inside it, proving it actually detects the anomaly?",
      "Is there any sleep left that controls ordering rather than backoff?",
      "Can I explain, in terms of snapshots, why FOR UPDATE on existing expense rows does not prevent the budget overrun?",
      "Does my retry helper re-run reads as well as writes, and does it avoid side effects inside the body?",
      "Do my README timelines match exactly what the tests do?",
    ],
    stretchGoals: [
      "Add an optimistic locking variant with a version column and compare retry counts against FOR UPDATE with 50 concurrent sessions.",
      "Show that the budget-row lock alone fails at REPEATABLE READ unless the transaction also updates the budget row, with a test for each case.",
      "Reproduce the lost update on MySQL 8 InnoDB and document how its Repeatable Read behaves differently.",
    ],
    repoChecklist: [
      "docker-compose.yml and a README with how to start the database and run the suite.",
      "Schema and reset script used by every test.",
      "One test file per anomaly, each with bug and fix tests, plus unit tests for the retry helper.",
      "README with an ASCII two-session timeline and the observed SQLSTATE for each anomaly.",
      "Output of 20 consecutive passing runs (or a CI badge running the loop).",
    ],
    relatedLessons: ["transactions-isolation-locking", "data-modeling-for-production"],
  },
  {
    slug: "database-scaling-playbook",
    title: "Design: Database Scaling Playbook for an ERP",
    kind: "design",
    summary:
      "Diagnose three different database load profiles in one ERP (a 9 a.m. dashboard rush, 5,000 scan inserts per second, and a whale tenant) and design a justified, phased migration from a single Postgres.",
    estimatedHours: 8,
    needsDiagram: true,
    designPrompt:
      "Draw three target architectures, one per profile, starting from today's single Postgres primary plus standby. Profile 1 (dashboards): API, pooler, tile cache, primary, read replica, outbox and projector worker, and summary tables; mark which tile reads go to the primary for read-after-write. Profile 2 (ingestion): scanners, API, queue, ingestion workers with batch size, the time-partitioned hot table with its retention window, the current-state and rollup tables, and the long-term raw store; label rows per second and GB per day on the arrows. Profile 3 (whale): tenant directory, shared cluster, dedicated whale cluster with standby and reporting replica, and the logical replication path used during migration. On every diagram, distinguish synchronous from asynchronous arrows and annotate expected staleness.",
    requirements: [
      "Each profile names its saturated resource and lists at least two specific pieces of evidence (views or metrics with expected values) that would confirm it.",
      "Each profile's strategies are listed in the order they would be applied, each with what it fixes, what it costs, what it does not fix, and how to roll it back.",
      "The document shows the arithmetic for: busy connections via Little's law for Profile 1, rows per day and storage for 13 months for Profile 2, and the share of the working set freed by moving the whale.",
      "Three target architecture diagrams are exported into the repo and match the designPrompt, including sync vs async arrows and staleness annotations.",
      "The migration path has at least 5 numbered phases, each independently shippable, with a rollback and a numeric success metric, and no phase requires more than 5 minutes of downtime.",
      "Each profile has at least two numeric success criteria (for example tile p95 under 300 ms at 160 queries per second, or 12,000 events per second sustained with replay lag under 5 s).",
      "A 'not doing' section lists at least three rejected strategies with the measurable trigger that would make you reconsider each.",
    ],
    hints: [
      "Profile by profile, ask which resource runs out first. The three answers are different, and that is the point of the exercise.",
      "For dashboards, compare two numbers: how often a tile is requested versus how often its underlying data changes. If the second is much smaller, precompute.",
      "For ingestion, multiply 5,000 rows per second by seconds per day and by 300 bytes, then by 13 months. Decide what part of that really needs to live in Postgres.",
      "For the whale, Postgres 15+ logical replication supports row filters on publications, which lets you copy one tenant's rows to a new cluster online.",
      "Order the migration so the first phase (pooling and measurement) makes every later phase safer and measurable.",
    ],
    rubric: [
      "Could I defend why I did not use read replicas for Profile 2 or global sharding for Profile 3?",
      "Is every number either derived in the document or labelled as an assumption with a way to verify it?",
      "Can each migration phase be rolled back, and do I know what metric tells me it worked?",
      "Have I identified every read that needs read-after-write consistency and routed it correctly?",
      "Would an engineer reading only the migration path know what to build first on Monday?",
    ],
    stretchGoals: [
      "Benchmark single-row INSERT, 1,000-row multi-row INSERT and COPY in Docker and use the measured rows per second to size the ingestion workers.",
      "Estimate the monthly cost of each target architecture on a provider of your choice and check it against the budget constraint.",
      "Write the tenant directory module with tests proving requests never reach the wrong cluster during a cutover.",
    ],
    repoChecklist: [
      "DESIGN.md with diagnosis, strategies, arithmetic, success criteria, migration path and the not-doing section.",
      "Exported diagram images for all three target architectures.",
      "Example SQL for the key schema changes (partitioned table, summary tables, publication with row filter).",
      "Benchmark scripts and results if you ran the optional ingestion benchmark.",
    ],
    relatedLessons: [
      "database-scaling-strategies",
      "diagnosing-database-bottlenecks",
      "data-modeling-for-production",
      "transactions-isolation-locking",
    ],
  },
];
