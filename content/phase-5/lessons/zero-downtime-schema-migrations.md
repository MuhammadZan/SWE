## Why this matters

It is 14:05 on a Tuesday. A teammate merges a harmless-looking migration: `ALTER TABLE invoices ADD COLUMN archived_at timestamptz;`. It is a nullable column with no default, which the Phase 4 table says is "safe in one step". Yet the API's p99 jumps from 80 ms to 30 seconds, the pool fills, health checks fail, and the load balancer starts returning 502s. Ninety seconds later everything recovers by itself.

What happened: a reporting job had been running a 4-minute `SELECT` on `invoices`. The `ALTER TABLE` needed an `ACCESS EXCLUSIVE` lock for a few milliseconds, so it waited behind the report. Every query that arrived after it, including plain `SELECT`s, queued behind the waiting `ALTER`. The migration itself was instant. The **lock queue** caused the outage.

Phase 4 gave you expand/contract as a release pattern. This lesson is the database half: which statements take which locks, how to make every migration fail fast instead of freezing traffic, how to add constraints and indexes to tables with 50 million rows, how to backfill safely, and how to enforce all of it in CI.

## Postgres lock levels you actually need

Postgres has eight table-level lock modes. For migrations you need to know four of them and what they conflict with:

| Lock mode | Taken by (examples) | Blocks reads? | Blocks writes? |
|---|---|---|---|
| `ACCESS SHARE` | `SELECT` | no | no |
| `ROW EXCLUSIVE` | `INSERT`, `UPDATE`, `DELETE` | no | no |
| `SHARE UPDATE EXCLUSIVE` | `VACUUM`, `ANALYZE`, `CREATE INDEX CONCURRENTLY`, `VALIDATE CONSTRAINT`, `REINDEX CONCURRENTLY` | no | no |
| `SHARE` | plain `CREATE INDEX` | no | **yes** |
| `SHARE ROW EXCLUSIVE` | `ADD FOREIGN KEY` (on both tables), `CREATE TRIGGER` | no | **yes** |
| `ACCESS EXCLUSIVE` | most `ALTER TABLE` forms, `DROP`, `TRUNCATE`, `VACUUM FULL`, `RENAME` | **yes** | **yes** |

Two facts make this dangerous:

1. **Most `ALTER TABLE` variants take `ACCESS EXCLUSIVE`**, even when the work is metadata-only and takes a millisecond. Adding a nullable column, dropping a column, renaming, setting a default: all need the strongest lock briefly.
2. **Lock requests queue in order.** A waiting `ACCESS EXCLUSIVE` request blocks every later request that conflicts with it, which is all of them.

```
time ->
report SELECT     [==== holds ACCESS SHARE for 4 min ===================]
ALTER TABLE            [waiting for ACCESS EXCLUSIVE ...................][x]
API SELECT                 [blocked behind ALTER .........................]
API INSERT                    [blocked ...................................]
pool exhausted -> 502s
```

You can see this live with `pg_blocking_pids()`:

```sql
SELECT pid, wait_event_type, state, left(query, 60) AS query,
       pg_blocking_pids(pid) AS blocked_by,
       now() - query_start AS waiting_for
FROM pg_stat_activity
WHERE cardinality(pg_blocking_pids(pid)) > 0;
```

### What rewrites the table

Separately from the lock, some changes rewrite every row while holding `ACCESS EXCLUSIVE`. On a large table that means minutes of total unavailability.

| Change | Rewrite? (Postgres 11+) |
|---|---|
| `ADD COLUMN` nullable, or with a constant / non-volatile default | No, metadata only |
| `ADD COLUMN ... DEFAULT gen_random_uuid()` (volatile default) | Yes |
| `ALTER COLUMN TYPE` int to bigint, text to int | Yes |
| `ALTER COLUMN TYPE` varchar(50) to varchar(100) or to text | No (binary-compatible) |
| `SET NOT NULL` | No rewrite, but a full scan under `ACCESS EXCLUSIVE` |
| `VACUUM FULL`, `CLUSTER` | Yes |

## Fail fast: lock_timeout and statement_timeout

The fix for the lock queue is to **never wait long for a lock**. If the migration cannot get its lock within a couple of seconds, it should give up, let traffic continue, and retry later.

```sql
-- top of every migration (or set on the migration role)
SET lock_timeout = '3s';        -- max wait to ACQUIRE a lock
SET statement_timeout = '15min'; -- max runtime of any one statement
```

Better, put it on the role so nobody forgets:

```sql
ALTER ROLE migrator SET lock_timeout = '3s';
ALTER ROLE migrator SET statement_timeout = '15min';
```

`lock_timeout` bounds the queue damage: in the worst case, traffic is blocked for 3 seconds instead of 4 minutes. Pair it with a retry loop in your migration runner:

```ts
// scripts/migrate-with-retry.ts
import { execa } from "execa";

for (let attempt = 1; attempt <= 5; attempt++) {
  try {
    await execa("npx", ["node-pg-migrate", "up"], { stdio: "inherit" });
    process.exit(0);
  } catch (err) {
    const msg = String((err as Error).message);
    if (!msg.includes("lock timeout")) throw err; // real error: stop
    const wait = 2 ** attempt * 1000 + Math.random() * 1000;
    console.warn(`lock timeout, retry ${attempt} in ${Math.round(wait)}ms`);
    await new Promise((r) => setTimeout(r, wait));
  }
}
process.exit(1);
```

For this to be safe, **each migration must be one short transaction or idempotent**, so a retried migration does not half-apply. Also run migrations away from known long jobs, and consider `idle_in_transaction_session_timeout` on app roles so a forgotten transaction cannot hold locks for hours.

## Indexes: CREATE INDEX CONCURRENTLY

Plain `CREATE INDEX` takes `SHARE`, which blocks all writes for the whole build. On a 40 GB table that is minutes of failed inserts.

```sql
-- bad: blocks INSERT/UPDATE/DELETE on invoices until done
CREATE INDEX invoices_tenant_due_idx ON invoices (tenant_id, due_date);

-- better: SHARE UPDATE EXCLUSIVE, writes continue
CREATE INDEX CONCURRENTLY IF NOT EXISTS invoices_tenant_due_idx
  ON invoices (tenant_id, due_date);
```

The rules that bite people:

- `CONCURRENTLY` **cannot run inside a transaction block**. Many migration tools wrap each file in a transaction; you must turn that off for this migration (node-pg-migrate: `pgm.noTransaction()`; in other tools check the docs for a per-migration opt-out, and put the statement alone in its own file).
- It scans the table twice and waits for all transactions that could see old snapshots, so a long-running transaction makes it hang. `lock_timeout` does not help here because it is waiting on transactions, not a lock; watch it.
- If it fails (deadlock, unique violation, cancel), it leaves an **INVALID** index that still costs write overhead. Find and drop them:

```sql
SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
DROP INDEX CONCURRENTLY IF EXISTS invoices_tenant_due_idx;
```

The same applies to `DROP INDEX CONCURRENTLY` and `REINDEX ... CONCURRENTLY` (Postgres 12+).

## Constraints without a full-table lock

### Foreign keys and CHECK: NOT VALID, then VALIDATE

Adding a foreign key normally scans the whole table while blocking writes on both tables. Split it:

```sql
-- migration 1: instant. New and updated rows are checked from now on.
ALTER TABLE invoice_lines
  ADD CONSTRAINT invoice_lines_invoice_fk
  FOREIGN KEY (invoice_id) REFERENCES invoices (id) NOT VALID;

-- migration 2: scans existing rows under SHARE UPDATE EXCLUSIVE.
-- Reads and writes continue.
ALTER TABLE invoice_lines VALIDATE CONSTRAINT invoice_lines_invoice_fk;
```

The same pattern works for `CHECK` constraints. Run the validate step in a separate transaction; if you do both in one transaction, the strong lock from step 1 is held during the scan and you gained nothing.

### NOT NULL on an existing column

`ALTER TABLE ... SET NOT NULL` scans the entire table under `ACCESS EXCLUSIVE`. Since Postgres 12, it skips the scan if a **valid** `CHECK (col IS NOT NULL)` constraint already proves it:

```sql
-- 1. instant
ALTER TABLE invoices ADD CONSTRAINT invoices_account_id_nn
  CHECK (account_id IS NOT NULL) NOT VALID;
-- 2. online scan
ALTER TABLE invoices VALIDATE CONSTRAINT invoices_account_id_nn;
-- 3. instant: Postgres uses the CHECK as proof
ALTER TABLE invoices ALTER COLUMN account_id SET NOT NULL;
-- 4. instant: the CHECK is now redundant
ALTER TABLE invoices DROP CONSTRAINT invoices_account_id_nn;
```

Postgres 18 also lets you add a `NOT NULL` constraint as `NOT VALID` directly; on 16 and 17 use the CHECK trick above.

### Defaults

Since Postgres 11, `ADD COLUMN status text NOT NULL DEFAULT 'draft'` is metadata-only because the default is a constant. A volatile default like `gen_random_uuid()` or `clock_timestamp()` rewrites the table. For those, add the column nullable, set the default for new rows, backfill, then add the constraint as above.

### Unique constraints

Build the unique index concurrently, then attach it:

```sql
CREATE UNIQUE INDEX CONCURRENTLY invoices_tenant_number_uq
  ON invoices (tenant_id, number);
ALTER TABLE invoices ADD CONSTRAINT invoices_tenant_number_uq
  UNIQUE USING INDEX invoices_tenant_number_uq;
```

## Renaming a column, end to end

Phase 4 sketched expand/contract for `customer_id` to `account_id`. Here is the database side in full, with what each step locks.

```
Step  Release  Migration / code                                Lock / risk
1     R1       ADD COLUMN account_id uuid (nullable)           ACCESS EXCLUSIVE, ms
               trigger copies customer_id -> account_id          (lock_timeout!)
               on INSERT/UPDATE
2     job      backfill in batches                             row locks only
3     job      CHECK NOT VALID + VALIDATE, then SET NOT NULL   online scan
               FK NOT VALID + VALIDATE
               CREATE INDEX CONCURRENTLY on account_id         online
4     R2       code reads and writes account_id only           none
5     R3       drop trigger, DROP COLUMN customer_id           ACCESS EXCLUSIVE, ms
```

A trigger instead of dual writes in application code means every writer is covered, including the admin script someone runs at midnight:

```sql
CREATE OR REPLACE FUNCTION invoices_sync_account_id() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.account_id IS NULL THEN
    NEW.account_id := NEW.customer_id;
  ELSIF NEW.customer_id IS NULL THEN
    NEW.customer_id := NEW.account_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER invoices_sync_account_id
  BEFORE INSERT OR UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_sync_account_id();
```

Before step 5, the code must have stopped referencing `customer_id` **everywhere**, including ORM models. Prisma and some other ORMs select every mapped column explicitly, so a column still in the model breaks after the drop. Remove it from the model one release before the drop.

An alternative for renames on very hot tables is a view-based swap, but the column-copy approach above is the one most teams can reason about and roll back.

## Backfilling large tables

`UPDATE invoices SET account_id = customer_id;` on 50 million rows is one huge transaction: it holds row locks on everything, generates a massive WAL burst that can make replicas lag by minutes, and doubles table size until vacuum catches up. Batch it by primary key:

```ts
// scripts/backfill-account-id.ts
import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.MIGRATOR_URL });

const BATCH = 5_000;
let lastId = "00000000-0000-0000-0000-000000000000";

while (true) {
  const { rows } = await pool.query(
    `WITH batch AS (
       SELECT id FROM invoices
       WHERE id > $1 AND account_id IS NULL
       ORDER BY id LIMIT $2
     )
     UPDATE invoices i SET account_id = i.customer_id
     FROM batch WHERE i.id = batch.id
     RETURNING i.id`,
    [lastId, BATCH],
  );
  if (rows.length === 0) break;
  lastId = rows.reduce((max, r) => (r.id > max ? r.id : max), lastId);

  const lag = await pool.query(
    `SELECT coalesce(max(extract(epoch FROM replay_lag)), 0) AS s
     FROM pg_stat_replication`,
  );
  const pause = Number(lag.rows[0].s) > 5 ? 2000 : 50; // throttle on lag
  await new Promise((r) => setTimeout(r, pause));
}
```

Properties of a good backfill: each batch is its own short transaction, it is **resumable** (the `account_id IS NULL` predicate makes reruns safe), it uses keyset pagination rather than `OFFSET`, and it throttles on replication lag. For multi-hour backfills run it as a background job (BullMQ or a Kubernetes Job), not inside the migration step of a deploy.

## Migration tooling and CI checks

| Tool | Style | Notes |
|---|---|---|
| Prisma Migrate | schema-first, generates SQL | Edit the generated SQL for concurrent indexes and NOT VALID; `prisma migrate deploy` in CI/CD, never `migrate dev` against production |
| Drizzle Kit | schema-first, generates SQL | Same: review and hand-edit generated SQL; check how your version handles transactions |
| node-pg-migrate | hand-written JS/TS or SQL | Per-migration `pgm.noTransaction()`, fine-grained control |
| sqitch | plain SQL with deploy / revert / verify scripts | Dependency graph instead of linear ordering, framework-agnostic |

Whatever the tool, generated SQL is a draft. A tool that turns a rename in your schema file into `RENAME COLUMN` will happily break the running version.

Lint migrations in CI with **squawk**, which parses Postgres SQL and flags unsafe patterns: non-concurrent index creation, adding a NOT NULL column without a safe path, constraints without `NOT VALID`, column renames and type changes, and missing `lock_timeout`.

```yaml
# .github/workflows/migrations.yml (excerpt)
- name: Lint migrations
  run: npx squawk-cli --assume-in-transaction migrations/*.sql
- name: Apply migrations to a prod-sized copy
  run: |
    npm run db:migrate
    psql "$DATABASE_URL" -c "SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid" \
      | grep -q "(0 rows)"
```

Also run every migration against a database with realistic volume in staging and record how long each took. A migration that takes 200 ms on 1,000 rows and 11 minutes on 40 million rows is the norm, not the exception.

## Rollback strategy

Down migrations sound reassuring, but most real rollbacks are **roll forward**. Once a release has written data in a new shape, an automatic `down` that drops the column destroys it.

- Make each migration backward compatible with the previous app version (expand only). Then rolling back the **code** never requires rolling back the **schema**.
- Keep destructive steps (drop column, drop table) in their own release, after a soak period, and take a backup or snapshot right before.
- Write `down` scripts for expand steps (they are cheap and safe), and treat `down` for contract steps as "restore from backup" territory.
- sqitch's `verify` scripts are a good habit regardless of tool: a query that proves the migration took effect.

## Common mistakes

- **No `lock_timeout`.** A metadata-only `ALTER` becomes a multi-minute outage behind one long query.
- **`CREATE INDEX` without `CONCURRENTLY`** on a large table, or `CONCURRENTLY` inside a transaction that the tool silently opened.
- **Ignoring INVALID indexes** left behind by failed concurrent builds.
- **Adding NOT VALID and VALIDATE in the same transaction**, which keeps the strong lock for the whole scan.
- **One giant `UPDATE` backfill** that saturates WAL, lags replicas and bloats the table.
- **Trusting ORM-generated SQL** for renames and type changes.
- **Dropping a column the ORM still selects.**

## In the real world

Teams at scale codify these rules: GitLab's migration style guide, Shopify and GitHub's online schema change tooling, and linters like squawk or strong_migrations in CI. Managed Postgres (RDS, Aurora, Cloud SQL, Neon, Supabase) changes none of the locking rules; the same `ALTER TABLE` locks the same way. Neon and Supabase branching make it cheap to rehearse a migration against a copy of production data, which is worth using. In interviews, "how would you add a NOT NULL foreign key to a 100M-row table with no downtime?" is a classic; the strong answer covers lock levels, `lock_timeout`, nullable add, batched backfill, `NOT VALID` plus `VALIDATE`, and the release ordering.

## Try it

1. In a local Postgres, create `invoices` with 5 million rows (`generate_series`).
2. In one psql session run `BEGIN; SELECT count(*) FROM invoices;` and leave it open.
3. In a second, run `ALTER TABLE invoices ADD COLUMN archived_at timestamptz;`. In a third, run `SELECT 1 FROM invoices LIMIT 1;` and watch it hang. Inspect with the `pg_blocking_pids` query.
4. Repeat with `SET lock_timeout = '2s';` before the `ALTER` and observe the failure instead of the hang.
5. Add a foreign key with `NOT VALID` then `VALIDATE`, and confirm with the third session that writes keep working during validation.
