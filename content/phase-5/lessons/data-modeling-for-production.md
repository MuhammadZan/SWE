## Why this matters

Indexes and query tuning (Phase 2) fix slow reads. They cannot fix a schema that lets bad data in. The expensive production incidents in ERPs are rarely "the query was slow". They are "two invoices share number INV-2024-0042", "a credit note references a customer from another tenant", "a booking overlaps another booking", "the totals are off by a cent across 40,000 lines", and "we deleted a customer and their invoices became orphans". Each of those is a modeling decision made in week one and paid for in year three.

Data outlives code. You will rewrite the API twice, but the `invoices` table and every row in it stay. This lesson covers the modeling decisions that are hard to change later: how far to normalize, how to isolate tenants, which rules the database must enforce, which types to use for money and time, how to delete and audit, and what to use for primary keys.

## Normalization in practice

Forget the textbook definitions for a moment. Each normal form removes one kind of duplication that causes update bugs.

- **1NF: one value per cell.** No `tags = 'urgent,export'` strings, no `phone1, phone2, phone3` columns. If you need to query or constrain an element, it belongs in its own row. (A `jsonb` column for genuinely schemaless attributes is fine; a comma list you `LIKE '%urgent%'` against is not.)
- **2NF: every column depends on the whole key.** In `invoice_lines (invoice_id, line_no, product_id, product_name, qty)`, `product_name` depends on `product_id`, not on the line's key. Rename a product and you must update a million lines.
- **3NF: no column depends on another non-key column.** `customers (id, postal_code, city)`: city depends on postal code. Usually you accept this one; the point is to know you are accepting it.

The practical test: **if one real-world fact changes, how many rows must change?** If the answer is "many, and missing one is a bug", normalize.

```sql
-- Bad: customer facts copied onto every order
CREATE TABLE orders (
  id bigint PRIMARY KEY,
  customer_name text,
  customer_email text,
  customer_vat_number text,
  total_cents bigint
);

-- Better: one fact, one place
CREATE TABLE customers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  email text NOT NULL,
  vat_number text
);
CREATE TABLE orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL,
  customer_id bigint NOT NULL,
  total_cents bigint NOT NULL
);
```

### Snapshots are not denormalization

There is one important exception that looks like duplication but is correct: **values that must be frozen at a point in time**. An issued invoice must show the customer's billing address and the product price *as they were when it was issued*. If you join to `customers` at render time and the customer later moves, you have legally altered an issued invoice.

```sql
CREATE TABLE invoices (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL,
  customer_id bigint NOT NULL,
  billing_address jsonb NOT NULL,     -- snapshot, intentionally copied
  issued_at timestamptz,
  ...
);
CREATE TABLE invoice_lines (
  ...
  product_id bigint NOT NULL,
  description text NOT NULL,          -- snapshot of product name at issue time
  unit_price numeric(19,4) NOT NULL   -- snapshot of price at issue time
);
```

The question to ask: "If the source changes, should this row change too?" If no, copy it and name it as a snapshot.

## When and how to denormalize

Denormalize for a measured read problem, not in advance. Typical justified cases:

| Pattern | Example | Kept correct by |
|---|---|---|
| Cached aggregate | `invoices.total_cents` = sum of lines | Same transaction that writes lines, or a trigger |
| Copied filter column | `invoice_lines.issued_at` so line reports filter without a join | Set on insert; invoices are immutable once issued |
| Counter | `customers.open_invoice_count` | Atomic `UPDATE ... SET n = n + 1` in the write transaction |
| Summary table | `monthly_revenue (tenant_id, month, cents)` | Upsert in the write path, or a periodic rebuild |

Rules that keep denormalization from rotting:

1. **One writer.** Exactly one code path (or one trigger) maintains the derived value.
2. **Same transaction** when it must be exact, a queue when eventual consistency is fine.
3. **A reconciliation query** you can run to prove derived equals source:

```sql
SELECT i.id, i.total_cents, sum(l.line_total_cents) AS lines_sum
FROM invoices i JOIN invoice_lines l ON l.invoice_id = i.id
GROUP BY i.id
HAVING i.total_cents <> sum(l.line_total_cents);
```

If you cannot write that query, you do not know whether your denormalized data is correct.

## Multi-tenant schema options

| | Shared tables + `tenant_id` | Schema per tenant | Database per tenant |
|---|---|---|---|
| Tenants supported | Millions | Hundreds to low thousands | Tens to hundreds |
| Isolation | Logical (bugs leak data) | Namespace | Physical |
| Migrations | One run | N runs, drift risk | N runs, N connection strings |
| Connections | Shared pool | Shared pool, `search_path` per request | Pool per database |
| Cross-tenant analytics | Trivial | `UNION ALL` across schemas | ETL |
| Noisy neighbour | Real risk | Real risk | Isolated |
| Move one tenant | Hard-ish (copy by `tenant_id`) | Dump one schema | Move one database |

Default for SaaS: **shared tables with `tenant_id`**, plus defences in depth:

```sql
-- 1. tenant_id on every tenant-owned table, leading every tenant-scoped index
CREATE INDEX ON invoices (tenant_id, issued_at DESC);

-- 2. Composite foreign keys so a row can never reference another tenant's row
ALTER TABLE customers ADD CONSTRAINT customers_tenant_id_id_key UNIQUE (tenant_id, id);
ALTER TABLE invoices
  ADD CONSTRAINT invoices_customer_fk
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id);

-- 3. Row-level security as a safety net
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invoices
  USING (tenant_id = current_setting('app.tenant_id')::bigint);
```

The composite foreign key is the underrated one: it makes a cross-tenant reference structurally impossible instead of "prevented by the service layer". RLS policies do not apply to the table owner or superusers, so the app must connect as a separate, non-owner role, and you set the tenant per transaction with `SET LOCAL app.tenant_id = '42'` (or `set_config('app.tenant_id', '42', true)`). That `LOCAL` matters once a transaction-mode pooler is involved, which the diagnosis lesson covers.

Schema-per-tenant looks tidy but migrations across 3,000 schemas take hours and partially fail; Postgres catalog bloat also hurts at that count. Database-per-tenant is right for a handful of large, regulated customers (data residency, contractual isolation), and a common hybrid is shared tables for the long tail plus dedicated databases for whales.

## Constraints are business rules

Every invariant the application "always" enforces will be violated by a script, a backfill, a race, or a second service. Push the ones that matter into the schema.

```sql
CREATE TABLE invoices (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  number text,
  status text NOT NULL CHECK (status IN ('draft','sent','paid','void')),
  total_cents bigint NOT NULL CHECK (total_cents >= 0),
  issued_at timestamptz,
  due_date date,
  -- a sent invoice must have a number and an issue date
  CHECK (status = 'draft' OR (number IS NOT NULL AND issued_at IS NOT NULL)),
  CHECK (due_date IS NULL OR issued_at IS NULL OR due_date >= issued_at::date),
  -- invoice numbers unique per tenant (NULLs for drafts are allowed)
  UNIQUE (tenant_id, number)
);
```

Exclusion constraints handle "no overlaps", which `UNIQUE` cannot express:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE room_bookings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id bigint NOT NULL,
  during tstzrange NOT NULL,
  EXCLUDE USING gist (room_id WITH =, during WITH &&)
);
```

Two concurrent inserts for overlapping ranges: one fails with SQLSTATE `23P01`, no matter how the application races. Compare that to the check-then-insert patterns from Phase 3. Postgres 18 also adds `WITHOUT OVERLAPS` for temporal primary and unique keys. MySQL has no exclusion constraints, and only enforces `CHECK` from 8.0.16.

Two operational notes: add constraints to big existing tables with `NOT VALID` then `VALIDATE CONSTRAINT` (validation takes a weaker lock), and catch constraint violations in TypeScript by SQLSTATE (`23505` unique, `23503` foreign key, `23514` check), mapping them to domain errors rather than 500s.

## Money and time types

**Money.** Never `float`/`double`/`real`: `0.1 + 0.2` is not `0.3`, and rounding errors accumulate across lines. Two good options:

- `bigint` in minor units (cents) for single-currency or when every currency has fixed decimals. Fast, simple; remember JPY has 0 decimals and some currencies have 3.
- `numeric(19,4)` when you need sub-cent precision (unit prices, FX, tax rates). Do rounding explicitly, at a defined step, with a defined rule.

Store the currency next to the amount (`amount numeric(19,4), currency char(3)`). Avoid Postgres's `money` type; its output depends on the `lc_monetary` setting. In Node, `pg` returns `numeric` and `bigint` as strings by design; keep them as strings or use a decimal library, never `parseFloat`.

**Time.**

- `timestamptz` for instants (`created_at`, `paid_at`). Despite the name it stores UTC and converts on output; plain `timestamp` silently drops the offset.
- `date` for business dates (`due_date`, `posting_date`). A due date is not an instant; "due 31 March" must not become "30 March 23:00" in another timezone.
- Store the tenant's IANA timezone (`Europe/Berlin`) and compute "which month does this payment belong to" with `(paid_at AT TIME ZONE t.timezone)::date`. Month-end reports are wrong at the edges otherwise.
- Ranges (`tstzrange`, `daterange`) for validity periods: they work with exclusion constraints and GiST indexes.

## Soft delete pitfalls

`deleted_at timestamptz` looks harmless and spreads problems everywhere:

1. **Every query must remember `WHERE deleted_at IS NULL`.** One forgotten filter leaks deleted data into a report.
2. **Unique constraints break.** Delete customer `acme@x.com`, try to recreate: duplicate key. Fix with a partial unique index:

```sql
CREATE UNIQUE INDEX customers_email_live
  ON customers (tenant_id, lower(email)) WHERE deleted_at IS NULL;
```

3. **Foreign keys stop meaning anything.** An invoice can reference a "deleted" customer and the database is happy.
4. **Tables and indexes grow forever**, and GDPR erasure requests still need a hard delete.

Better options, by case: for legally immutable records (invoices, ledger entries), never delete; use status transitions (`void`) and reversing entries. For "undo" UX, keep a short-lived soft delete and purge after 30 days. For records that are really gone but must be retained, **move** them to an archive table in one transaction (`DELETE ... RETURNING` into `INSERT`), keeping the hot table clean.

## Audit and history tables

"Who changed this credit limit, and what was it before?" needs history. A generic trigger-based audit log is cheap to add:

```sql
CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name text NOT NULL,
  row_id bigint NOT NULL,
  tenant_id bigint,
  op char(1) NOT NULL,               -- I / U / D
  changed_by text DEFAULT current_setting('app.user_id', true),
  changed_at timestamptz NOT NULL DEFAULT now(),
  old_row jsonb,
  new_row jsonb
);

CREATE FUNCTION audit_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r jsonb := to_jsonb(COALESCE(NEW, OLD));
BEGIN
  INSERT INTO audit_log (table_name, row_id, tenant_id, op, old_row, new_row)
  VALUES (TG_TABLE_NAME,
          (r->>'id')::bigint,
          (r->>'tenant_id')::bigint,
          left(TG_OP, 1),
          CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
          CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END);
  RETURN NULL;
END $$;

CREATE TRIGGER customers_audit AFTER INSERT OR UPDATE OR DELETE ON customers
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();
```

Trade-offs: triggers capture every write path (including psql fixes) but add write cost; app-level events carry intent ("approved by manager") that a row diff cannot. Many teams use both. When history is part of the domain (price lists, tax rates, employee salaries), model it explicitly with `valid_during daterange` and an exclusion constraint instead of reconstructing it from an audit log. Partition the audit table by month; it will be your largest table.

## Primary keys: bigint vs UUID v4 vs UUID v7

| | `bigint` identity | UUID v4 | UUID v7 |
|---|---|---|---|
| Size | 8 bytes | 16 bytes | 16 bytes |
| Index locality | Sequential, appends to right edge | Random, inserts hit random pages | Time-ordered, near right edge |
| Generate outside DB | No (needs round trip) | Yes | Yes |
| Leaks | Row counts, growth rate | Nothing | Creation time |
| Merge across shards/regions | Collisions | Safe | Safe |

UUID v4's randomness is the problem at scale: each insert touches a random leaf page of the primary key index, so once the index exceeds memory, inserts cause random I/O and page splits. UUID v7 puts a millisecond timestamp in the high bits, giving most of bigint's locality while keeping client-side generation. Postgres 18 ships a built-in `uuidv7()`; on older versions generate it in the application (the `uuid` npm package supports v7) or use an extension.

A sensible default: `bigint` identity internally for tables that never leave the database's control, UUID v7 for entities that are exposed in URLs, generated offline, or may one day move between shards. Do not expose sequential IDs in public URLs of a multi-tenant app; it invites enumeration.

## Common mistakes

- Enforcing invariants only in the service layer ("we check that in the API") and discovering duplicates after the first backfill script.
- Joining live master data into issued documents instead of snapshotting it.
- Using `timestamp` without time zone, then computing month-end in the server's timezone.
- Adding `deleted_at` to everything without partial unique indexes or a purge plan.
- Single-column foreign keys in a multi-tenant schema, allowing cross-tenant references.
- Using UUID v4 as the clustered-ish primary key of a billion-row table and wondering why inserts degrade.
- Denormalizing "for performance" with no reconciliation query and two code paths writing the copy.

## In the real world

Mature SaaS schemas look boring: `tenant_id` everywhere, composite foreign keys, many `CHECK` constraints, `numeric` or `bigint` money, `timestamptz` everywhere, append-only ledgers, and an audit table that is the biggest thing in the database. Teams migrating from schema-per-tenant to shared tables (or the reverse for a few whales) is a common multi-quarter project.

Interviewers probe this with "design the schema for invoicing" and then push: "How do you stop two invoices getting the same number? What happens when a customer's address changes? How would you isolate tenants? Why not UUIDs?" A strong answer names the constraint, the type, and the trade-off rather than "I'd validate it in the API".

## Try it

In a local Postgres 16+ (18 if you want `uuidv7()`), create `tenants`, `customers`, and `invoices` with: composite foreign keys on `(tenant_id, id)`, a `CHECK` that sent invoices have a number, a per-tenant unique invoice number, and a partial unique index on live customer emails. Then write five `INSERT` statements that each try to break one rule (cross-tenant customer, duplicate number, sent without number, negative total, recreated deleted email) and confirm each fails with the SQLSTATE you expect. Finally add the audit trigger to `customers`, update a credit limit, and query the before/after values from `audit_log`.
