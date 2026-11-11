## Why this matters

Your multi-tenant ERP has 400 customers in one database. Every query in the codebase filters by `tenant_id`, and code review checks for it. Then a new report endpoint ships with `SELECT * FROM invoices WHERE status = 'overdue'`. No tenant filter. For three days, every customer who opens the overdue report sees every other customer's overdue invoices: names, amounts, addresses. That is a reportable data breach under GDPR, and no attacker was involved.

Look at what else is usually true in that same system: the app connects as the `postgres` superuser, the same credentials run migrations, the password has not changed in three years and sits in five `.env` files, the database accepts connections from the whole VPC without TLS verification, and nightly dumps are copied to a developer's laptop for debugging.

Application code is one layer. This lesson makes the database itself enforce the rules, so a single forgotten `WHERE` or a single leaked credential does not become a breach.

## Least-privilege roles

Use separate roles for separate jobs. In Postgres, users and groups are both roles; a "group" role is `NOLOGIN`.

```
 owner      (NOLOGIN)  owns schema and tables; nobody logs in as it
 migrator   (LOGIN)    member of owner; runs DDL in CI/CD only
 app_rw     (LOGIN)    SELECT/INSERT/UPDATE/DELETE on app tables; no DDL
 app_ro     (LOGIN)    SELECT only; reporting, BI, read replicas
 replicator (LOGIN, REPLICATION) streaming replication only
```

```sql
CREATE ROLE erp_owner NOLOGIN;
CREATE ROLE migrator LOGIN PASSWORD :'migrator_pw' IN ROLE erp_owner;
CREATE ROLE app_rw LOGIN PASSWORD :'app_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE app_ro LOGIN PASSWORD :'ro_pw';

CREATE SCHEMA app AUTHORIZATION erp_owner;

-- lock down defaults
REVOKE ALL ON DATABASE erp FROM PUBLIC;
GRANT CONNECT ON DATABASE erp TO app_rw, app_ro, migrator;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;  -- default since Postgres 15

GRANT USAGE ON SCHEMA app TO app_rw, app_ro;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO app_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO app_rw;
GRANT SELECT ON ALL TABLES IN SCHEMA app TO app_ro;
```

`GRANT ... ON ALL TABLES` only covers tables that exist **now**. Next week's migration creates a table and the app gets `permission denied`. Fix that with default privileges, which apply to objects created later **by a specific role**:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE erp_owner IN SCHEMA app
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE erp_owner IN SCHEMA app
  GRANT USAGE, SELECT ON SEQUENCES TO app_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE erp_owner IN SCHEMA app
  GRANT SELECT ON TABLES TO app_ro;
```

The `FOR ROLE` part is where people get stuck: the default applies to objects created by `erp_owner`. So migrations should run `SET ROLE erp_owner;` first, or tables end up owned by `migrator` and the defaults do not fire.

Then go further where the business needs it: an append-only ledger can get `REVOKE UPDATE, DELETE ON app.ledger_entries FROM app_rw;`, so even a bug cannot rewrite history. Column-level grants (`GRANT SELECT (id, name) ON customers TO support_ro`) are useful for support tooling.

Why "no superuser for the app" matters concretely: a superuser bypasses every permission check and RLS policy, can read server files with `COPY ... FROM` / `pg_read_file`, and can run shell commands via `COPY ... TO PROGRAM`. One SQL injection as superuser is a full server compromise. On managed services you never get true superuser anyway (`rds_superuser`, `cloudsqlsuperuser` are restricted), but the admin role is still far too powerful for an app.

## Row-Level Security for tenant isolation

RLS lets the database add a filter to every query on a table, based on a policy. The forgotten `WHERE tenant_id = ...` stops being a breach because Postgres adds it anyway.

```sql
ALTER TABLE app.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.invoices FORCE ROW LEVEL SECURITY; -- apply to the table owner too

CREATE POLICY tenant_isolation ON app.invoices
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
```

- `USING` filters rows for `SELECT`, `UPDATE`, `DELETE`.
- `WITH CHECK` validates new rows on `INSERT` and `UPDATE`, so tenant A cannot write a row with tenant B's id or move a row to tenant B.
- `current_setting('app.tenant_id', true)` returns NULL instead of erroring when unset. After a variable has been set once in a session it can come back as an empty string rather than NULL, so `nullif(..., '')` prevents a cast error. With no tenant set, `tenant_id = NULL` is never true: **zero rows**, which is the safe failure.
- If no policy exists for a command, RLS denies it by default.

### Setting the tenant per transaction, safely with a pool

Pooled connections are reused by different requests. A session-level `SET app.tenant_id = 'A'` stays on the connection, and the next request on that connection, for tenant B, runs as tenant A. With PgBouncer in transaction mode, session state leaks between completely unrelated clients.

Set the variable **transaction-locally**, and always inside an explicit transaction:

```ts
// db/with-tenant.ts
import type { Pool, PoolClient } from "pg";

export async function withTenant<T>(
  pool: Pool,
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // set_config(..., true) == SET LOCAL, but accepts a bind parameter
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
```

`SET LOCAL app.tenant_id = $1` does not accept bind parameters, which tempts people into string concatenation. `set_config` with the third argument `true` is the parameterised, transaction-scoped equivalent. When the transaction ends the setting disappears, so a reused connection starts with no tenant and sees nothing.

The tenant id itself must come from the authenticated session (verified JWT or server session), never from a request body or header the client controls.

### RLS pitfalls

| Pitfall | Effect | Fix |
|---|---|---|
| App connects as table owner without `FORCE` | owner bypasses RLS | `FORCE ROW LEVEL SECURITY`, and do not let the app own tables |
| App role is superuser or has `BYPASSRLS` | RLS ignored entirely | `NOBYPASSRLS`; reserve bypass for migrations and admin jobs |
| Views created by the owner | views run with the owner's rights, bypassing RLS | `CREATE VIEW ... WITH (security_invoker = true)` (Postgres 15+) |
| `SECURITY DEFINER` functions | run as their owner | avoid, or filter explicitly and set `search_path` |
| Session-level `SET` with a pool | tenant leaks across requests | `set_config(..., true)` inside a transaction |
| Policy only on parent tables | child tables like `invoice_lines` unprotected | policy on every tenant table; put `tenant_id` on child tables |
| No index on `tenant_id` | the policy predicate forces scans | lead composite indexes with `tenant_id` |
| Global unique constraints | an insert error reveals another tenant's value exists | make uniqueness per tenant: `UNIQUE (tenant_id, number)` |

Background jobs and admin tools that need cross-tenant access should use a separate role with `BYPASSRLS`, explicitly, so the bypass is visible and auditable. Supabase builds its whole data API on RLS with the user id from the JWT, which is a good example of the same pattern at scale.

## SQL injection at the database layer

Parameterised queries are the first defence and you already use them. The database layer adds defence in depth:

```ts
// bad: dynamic identifier built from user input
await client.query(`SELECT * FROM invoices ORDER BY ${req.query.sort}`);

// better: allowlist identifiers; values are always parameters
const SORTABLE = { due: "due_date", total: "total_cents" } as const;
const col = SORTABLE[req.query.sort as keyof typeof SORTABLE] ?? "due_date";
await client.query(`SELECT * FROM invoices WHERE status = $1 ORDER BY ${col}`, [status]);
```

Watch for injection in places parameters do not reach: dynamic SQL in PL/pgSQL (`EXECUTE` with string concatenation; use `format('%I', ...)` and `USING`), `ORDER BY` and table names, and raw-query escape hatches in ORMs (`$queryRawUnsafe`, `sql.raw`). Least privilege limits what an injection can do: `app_ro` cannot `DROP`, `app_rw` cannot read `pg_shadow` or run `COPY TO PROGRAM`, and RLS keeps it inside one tenant.

## Encryption

### In transit

Enable TLS on the server and **verify** the certificate on the client. `sslmode=require` encrypts but accepts any certificate, so a man in the middle still works.

```
# pg_hba.conf: TLS only, SCRAM passwords, app subnet only
hostssl  erp  app_rw  10.0.1.0/24  scram-sha-256
hostnossl all all     0.0.0.0/0     reject
```

```ts
new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { ca: readFileSync("/etc/ssl/rds-ca.pem", "utf8"), rejectUnauthorized: true },
});
```

Managed providers publish their CA bundles. Use `password_encryption = scram-sha-256` (the default since Postgres 14), not MD5.

### At rest

Managed services encrypt storage, snapshots and backups with KMS keys; self-hosted means encrypted disks plus encrypted backup repositories (`repo1-cipher-type` in pgBackRest). Disk encryption protects against stolen disks and discarded hardware. It does **nothing** against anyone who can connect with valid credentials.

### Column-level encryption for PII

For high-value fields (national ID numbers, bank account numbers), encrypt the column so a database dump or read-only credential leak exposes ciphertext.

| | pgcrypto (`pgp_sym_encrypt`) | Application-level (envelope encryption with KMS) |
|---|---|---|
| Where the key lives | sent to the DB in every query | in the app / KMS, never in the DB |
| Key exposure | can appear in logs, `pg_stat_statements`, `pg_stat_activity` | not visible to the DB or DBAs |
| Queryability | decrypt in SQL | app decrypts; search via a blind index |
| Recommended for | low-risk convenience | real PII protection |

```ts
// app-level: AES-256-GCM with a data key from KMS; store iv + tag + ciphertext
// for lookups, store a separate HMAC "blind index"
const ibanHash = createHmac("sha256", BLIND_INDEX_KEY).update(normalize(iban)).digest("hex");
```

## Secrets rotation and network isolation

- Store credentials in a secret manager (AWS Secrets Manager, GCP Secret Manager, Vault, Doppler), not in committed `.env` files.
- Rotate without downtime by using **two login roles** with identical grants (`app_rw_a`, `app_rw_b`): rotate the unused one's password, deploy the app with it, then rotate the other. Or use short-lived credentials: RDS IAM authentication tokens, Vault dynamic database credentials, Cloud SQL IAM auth.
- Put the database in private subnets with no public IP; allow only the app's security group and a bastion or SSM-style access path. If you use a provider with public endpoints (Neon, Supabase), use IP allowlists where available and always verify TLS.

## Audit logging

Built-in logging (`log_statement = 'ddl'`, `log_connections = on`) covers basics. For "who read or changed what", use **pgaudit**:

```
shared_preload_libraries = 'pgaudit'
pgaudit.log = 'ddl, role'          # schema and privilege changes, all sessions
pgaudit.role = 'auditor'           # object auditing: grants to this role define what is logged
```

```sql
GRANT SELECT ON app.customers_pii TO auditor;  -- now every SELECT on it is logged
```

Ship audit logs off the database host to append-only storage, and never log statement parameters for tables with secrets or PII unless that log is itself protected. pgaudit is available on RDS, Aurora and Cloud SQL.

## Backups as a data-leak vector, and GDPR deletion

Every backup is a full copy of every tenant's data. Encrypt backup repositories, keep them in a separate account with tightly scoped access, and do not restore production dumps onto laptops. For dev and staging, use generated data or a masked copy (anonymise emails, names, IBANs during restore).

GDPR's right to erasure meets immutable backups. Common, defensible approaches:

- Delete from the live database promptly, and document that backups expire after N days (for example 35), so the data ages out. Keep a **deletion log** so that if you restore a backup, you re-apply deletions before going live.
- **Crypto-shredding**: encrypt each tenant's or user's PII with its own key; deleting the key makes every copy, including backups, unreadable.

## Common mistakes

- **App connects as `postgres` or the table owner**, so RLS and grants are bypassed.
- **Forgetting default privileges**, then "fixing" permission errors by granting everything.
- **Session-level `SET` for tenant context** behind a pool.
- **`ENABLE` without `FORCE`** when the app role owns the tables.
- **`sslmode=require` without verification.**
- **pgcrypto with keys in SQL text**, leaking to logs.
- **Backups and staging copies** treated as less sensitive than production.

## In the real world

Teams with strict isolation needs combine application-level tenant scoping with RLS as the safety net, plus a CI test that tries cross-tenant access with the real app role. Security questionnaires from enterprise customers (SOC 2, ISO 27001) ask exactly these questions: least privilege, encryption in transit and at rest, audit logs, credential rotation, backup access. In interviews, "how would you prevent tenant data leaks in a shared-schema SaaS?" is common; a strong answer mentions RLS, how tenant context is set with pooling, and the bypass paths.

## Try it

1. Create `erp_owner`, `app_rw`, and an `invoices` table with `tenant_id`.
2. Enable and force RLS with the policy above, and grant `app_rw` DML.
3. As `app_rw`, run `SELECT count(*) FROM app.invoices;` with no tenant set (expect 0), then inside `BEGIN; SELECT set_config('app.tenant_id', '<A>', true); ...` (expect A's rows only).
4. Try to `INSERT` a row with tenant B's id while set to A, and confirm the `WITH CHECK` violation.
