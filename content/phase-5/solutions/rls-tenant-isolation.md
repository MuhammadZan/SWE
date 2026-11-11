## What a strong solution looks like

A strong submission treats RLS as a safety net that is impossible to switch off by accident. The app role cannot bypass it (not owner, not superuser, no `BYPASSRLS`), every tenant table has a forced policy with both `USING` and `WITH CHECK`, child tables carry their own `tenant_id` with a composite foreign key so a line can never point across tenants, and tenant context lives only for the duration of one transaction.

The tests are the real deliverable. They run the deliberately buggy query and prove it is harmless, they cover writes as well as reads, and they include the two failure modes people miss: a pooled connection reused without tenant context, and concurrent requests from different tenants on a small pool. The README explains the bypass paths that remain (owner, superuser, `BYPASSRLS`, security-definer functions, views without `security_invoker`) and how each is closed.

## Reference approach

### Roles and default privileges

```sql
CREATE ROLE erp_owner NOLOGIN;
CREATE ROLE migrator LOGIN PASSWORD :'migrator_pw' IN ROLE erp_owner;
CREATE ROLE app LOGIN PASSWORD :'app_pw' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE admin_jobs LOGIN PASSWORD :'jobs_pw' BYPASSRLS;

CREATE SCHEMA erp AUTHORIZATION erp_owner;
GRANT USAGE ON SCHEMA erp TO app, admin_jobs;

ALTER DEFAULT PRIVILEGES FOR ROLE erp_owner IN SCHEMA erp
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app, admin_jobs;
ALTER DEFAULT PRIVILEGES FOR ROLE erp_owner IN SCHEMA erp
  GRANT USAGE, SELECT ON SEQUENCES TO app, admin_jobs;
```

Every migration file begins with `SET ROLE erp_owner;` so new tables are owned by the owner role and the default privileges apply.

### Schema changes for isolation

```sql
ALTER TABLE invoices DROP CONSTRAINT invoices_number_key;
ALTER TABLE invoices ADD CONSTRAINT invoices_tenant_number_uq UNIQUE (tenant_id, number);
ALTER TABLE invoices ADD CONSTRAINT invoices_tenant_id_id_uq UNIQUE (tenant_id, id);

ALTER TABLE invoice_lines ADD COLUMN tenant_id uuid NOT NULL;  -- empty table in the exercise
ALTER TABLE invoice_lines
  ADD CONSTRAINT invoice_lines_invoice_fk
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices (tenant_id, id);

CREATE INDEX ON invoices (tenant_id, status);
CREATE INDEX ON invoice_lines (tenant_id, invoice_id);
```

The global `UNIQUE (number)` was a leak: tenant A inserting `INV-0001` would get a unique violation if tenant B already had it, revealing B's data. The composite foreign key matters because foreign key checks run without RLS; without it, a line in tenant A can reference tenant B's invoice. Do the same for `invoices.customer_id`.

### Policies

```sql
CREATE FUNCTION erp.current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customers','invoices','invoice_lines'] LOOP
    EXECUTE format('ALTER TABLE erp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE erp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON erp.%I
         USING (tenant_id = erp.current_tenant())
         WITH CHECK (tenant_id = erp.current_tenant())', t);
  END LOOP;
END $$;
```

A `STABLE` helper keeps policies readable and lets the planner evaluate it once per query. `nullif(..., '')` matters: after `set_config` has been used once on a connection, the reset value is an empty string, and `''::uuid` would raise an error rather than return no rows.

### Tenant context with a pool

```ts
export async function withTenant<T>(tenantId: string, fn: (c: PoolClient) => Promise<T>) {
  if (!UUID_RE.test(tenantId)) throw new Error("invalid tenant id");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
```

### Tests

```ts
it("buggy unfiltered query only sees the current tenant", async () => {
  const rows = await withTenant(tenantA, (c) => unsafeListAllInvoices(c));
  expect(rows.length).toBe(3);
  expect(rows.every((r) => r.tenant_id === tenantA)).toBe(true);
});

it("cannot insert a row for another tenant", async () => {
  await expect(
    withTenant(tenantA, (c) =>
      c.query("INSERT INTO erp.invoices (tenant_id, customer_id, number, total_cents) VALUES ($1,$2,'X',1)",
        [tenantB, customerB])),
  ).rejects.toThrow(/row-level security/);
});

it("does not leak tenant context through a reused connection", async () => {
  const pool1 = new Pool({ connectionString: APP_URL, max: 1 });
  await withTenantOn(pool1, tenantA, (c) => c.query("SELECT 1"));
  const { rows } = await pool1.query("SELECT count(*)::int AS n FROM erp.invoices");
  expect(rows[0].n).toBe(0);
});
```

The concurrency test fires 200 promises alternating A and B through a pool of 3, each asserting all returned `tenant_id`s match. Run it several times; flaky failures here mean session-level state is leaking.

## Common mistakes

- **Testing as the owner or superuser.** Tests pass trivially and prove nothing, or the policies are bypassed and tests are adjusted to match. Always connect as the real app role.
- **`ENABLE` without `FORCE`**, combined with the app owning the tables.
- **Only `USING`, no `WITH CHECK`**, so tenant A can insert or move rows into tenant B.
- **Session-level `SET`** or `set_config(..., false)`, which leaks across pooled connections and is catastrophic behind PgBouncer transaction mode.
- **Leaving `invoice_lines` without `tenant_id`** and relying on a join policy (`EXISTS (SELECT 1 FROM invoices ...)`), which works but is slower and easier to get wrong; and forgetting that foreign keys bypass RLS.
- **Tenant id from a request header** rather than the authenticated session.
- **Only read tests.** Write paths are where real cross-tenant corruption happens.

## Trade-offs worth discussing

- **RLS plus explicit filters, or RLS only?** Keeping `WHERE tenant_id = $1` in queries helps the planner and readability; RLS is the backstop. Most teams keep both.
- **Performance.** Policies add a predicate to every query. With `tenant_id`-leading indexes the overhead is small; without them, it can force scans. Functions in policies must be cheap and non-volatile.
- **Shared schema vs schema-per-tenant vs database-per-tenant.** RLS makes shared schema safer, but large regulated tenants may still need physical isolation. Migrations across thousands of schemas are their own operational problem.
- **Where the bypass lives.** A `BYPASSRLS` role for jobs is explicit but powerful; an alternative is jobs that loop over tenants and use `withTenant` per tenant, which keeps the safety net on.
- **ORMs.** Prisma and Drizzle can run inside an interactive transaction with `set_config`; check how the ORM uses connections, because a query outside the transaction runs without tenant context.

## Grade yourself

| Dimension | Strong | Acceptable | Needs work |
|---|---|---|---|
| Role separation | Owner NOLOGIN, migrator, app without BYPASSRLS, explicit bypass role, default privileges tested by a migration that adds a table | Separate app and migration roles, grants done manually | App connects as owner or superuser |
| Policies | ENABLE + FORCE, USING + WITH CHECK on every tenant table, empty setting yields zero rows | Policies on main tables, missing on one child table or missing WITH CHECK | RLS on one table, or setting missing throws errors in normal flows |
| Schema hardening | Per-tenant uniques, composite FKs preventing cross-tenant references, tenant-leading indexes | Per-tenant uniques but child rows can reference other tenants | Global uniques remain, no indexes |
| Pool safety | Transaction-local set_config with bind param, leak and concurrency tests pass repeatedly | Transaction-local setting, no leak test | Session-level SET or string-concatenated SQL |
| Tests | Read, write, update-to-other-tenant, child-row, no-tenant, leak, concurrency and bypass-role cases against real Postgres in CI | Reads and inserts covered | Manual checks only |

## Going further

- Put PgBouncer in transaction mode between the tests and Postgres and rerun the suite.
- Add a CI check that fails if any table in the `erp` schema with a `tenant_id` column lacks RLS (`pg_class.relrowsecurity` and `relforcerowsecurity`).
- Measure policy overhead with `EXPLAIN (ANALYZE, BUFFERS)` at 10 million rows, with and without the tenant index.
