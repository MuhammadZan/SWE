## Scenario

Your invoicing SaaS stores every tenant in one Postgres database, shared schema, with a `tenant_id` column on each table. Isolation today depends on every query remembering `WHERE tenant_id = $1`. Last quarter a new report endpoint forgot it and showed one customer another customer's invoices for an afternoon. Leadership wants a guarantee that does not depend on every developer being perfect.

Your job: make Postgres itself enforce tenant isolation with Row-Level Security, wire tenant context through a connection pool safely, and prove with automated tests that a query missing its tenant filter still cannot read or write another tenant's data.

## Starting point

```sql
CREATE TABLE tenants (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
);

CREATE TABLE customers (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name      text NOT NULL,
  email     text NOT NULL
);

CREATE TABLE invoices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  number      text NOT NULL,
  status      text NOT NULL DEFAULT 'draft',
  total_cents bigint NOT NULL,
  UNIQUE (number)            -- note: global, not per tenant
);

CREATE TABLE invoice_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   uuid NOT NULL REFERENCES invoices(id),
  description  text NOT NULL,
  amount_cents bigint NOT NULL
);
```

The current app connects as `postgres` and runs migrations with the same user. Use Node 20+ with `pg` (or postgres.js), Postgres 16+, Docker, and Vitest.

## What to build

1. **Roles.** A `NOLOGIN` owner role that owns the schema and tables, a `migrator` login that runs migrations as the owner, an `app` login with only DML on application tables and no `BYPASSRLS`, and an `admin_jobs` login with `BYPASSRLS` for cross-tenant background jobs. Use default privileges so tables created by future migrations are automatically usable by `app`.
2. **Schema fixes.** Make the schema RLS-friendly: `tenant_id` on `invoice_lines` (with a composite foreign key that guarantees a line belongs to an invoice of the same tenant), per-tenant uniqueness for invoice numbers, and indexes that lead with `tenant_id`.
3. **Policies.** Enable and force RLS on every tenant table, with `USING` and `WITH CHECK` driven by a transaction-local setting such as `app.tenant_id`. No tenant set must mean zero rows, not an error and not all rows.
4. **Pool-safe tenant context.** A `withTenant(tenantId, fn)` helper that runs `fn` inside a transaction with the tenant set via `set_config(..., true)`, so the setting cannot leak to the next user of the pooled connection. Expose a repository or two (`listInvoices`, `createInvoice`) built on it, including one deliberately "buggy" function with no tenant filter.
5. **Tests.** An automated suite that runs against a real Postgres (Testcontainers or a compose service) and proves isolation.

## Constraints

- The application must never connect as a superuser, the table owner, or a role with `BYPASSRLS`.
- Tenant ids are bind parameters only; no string concatenation into SQL.
- Migrations are SQL files applied by a tool of your choice (node-pg-migrate, Drizzle, Prisma, sqitch or plain psql scripts) and are rerunnable from an empty database.
- Each test must set up its own data for two tenants, A and B.

## How to measure and verify

Your test suite must demonstrate, using the `app` role:

- The buggy `SELECT * FROM invoices` with no `WHERE` returns only tenant A's rows when running as A.
- With no tenant set, every tenant table returns zero rows.
- Inserting an invoice or invoice line with tenant B's id while running as A fails with a row-level security error.
- Updating or deleting B's rows as A affects zero rows, and updating A's row to set `tenant_id = B` fails.
- Creating an invoice line that points at B's invoice while running as A fails.
- Pool leak test: with a pool of size 1, run a request as A, then a request with no tenant on the same connection, and assert the second sees zero rows.
- Concurrency test: 200 interleaved requests across A and B on a small pool, each asserting it only ever sees its own tenant's rows.
- The `admin_jobs` role can read across tenants, proving the bypass is explicit.

Also record, in the README, `EXPLAIN (ANALYZE)` for `listInvoices` with 100,000 invoices across 50 tenants, showing the policy predicate uses an index.
