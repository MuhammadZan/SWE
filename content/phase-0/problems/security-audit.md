## Scenario

Your company just acquired InvoiceLite, a tiny invoicing product that a contractor built in a weekend and that has quietly gained 40 paying tenants. Before it gets merged into the main ERP, the CTO wants an independent security review. You are the reviewer. Nobody gave you a threat model, a pen-test report or a list of known issues. You get the source code, the schema and two days.

This is a realistic shape of work. Inherited code is where most real vulnerabilities live, and the skill being practiced is not "know the OWASP list" but "read unfamiliar code with an attacker's eyes, prove each finding, rank it, fix it, and make sure it never comes back."

## Starting point

Create a Node 20+ TypeScript project with `express`, `cors`, `jsonwebtoken` and `pg`, and paste this file in as `src/server.ts` without changing it. Line numbers in your report should refer to this original file, so commit it untouched as your first commit.

```ts
// src/server.ts: "InvoiceLite" v0.3
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { Pool } from "pg";

const JWT_SECRET = "invoicelite-secret-2023";
const pool = new Pool({
  connectionString: "postgres://invoicelite:Sup3rS3cret!@db.internal:5432/invoicelite",
});

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

type AuthUser = { id: string; tenantId: string; role: string };
type AuthedRequest = Request & { user?: AuthUser };

function hashPassword(password: string): string {
  return crypto.createHash("md5").update(password).digest("hex");
}

function auth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? "";
  const token = header.replace("Bearer ", "");
  try {
    req.user = jwt.verify(token, JWT_SECRET) as AuthUser;
    next();
  } catch (err) {
    res.status(401).json({ error: "Unauthorized", detail: String(err) });
  }
}

app.post("/signup", async (req, res, next) => {
  try {
    const { email, password, tenantName, role } = req.body;
    const tenant = await pool.query(
      "INSERT INTO tenants (name) VALUES ($1) RETURNING id",
      [tenantName],
    );
    const user = await pool.query(
      "INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING *",
      [tenant.rows[0].id, email, hashPassword(password), role ?? "owner"],
    );
    res.status(201).json(user.rows[0]);
  } catch (err) {
    next(err);
  }
});

app.post("/login", async (req, res, next) => {
  try {
    console.log("login attempt", req.body);
    const { email, password } = req.body;
    const result = await pool.query(
      `SELECT * FROM users WHERE email = '${email}' AND password_hash = '${hashPassword(password)}'`,
    );
    if (result.rowCount === 0) {
      const exists = await pool.query("SELECT 1 FROM users WHERE email = $1", [email]);
      return res
        .status(401)
        .json({ error: exists.rowCount ? "Wrong password" : "No account with that email" });
    }
    const u = result.rows[0];
    const token = jwt.sign({ id: u.id, tenantId: u.tenant_id, role: u.role }, JWT_SECRET);
    res.json({ token });
  } catch (err) {
    next(err);
  }
});

app.get("/invoices", auth, async (req: AuthedRequest, res, next) => {
  try {
    const search = (req.query.search as string) ?? "";
    const sort = (req.query.sort as string) ?? "created_at";
    const result = await pool.query(
      `SELECT * FROM invoices
       WHERE tenant_id = $1 AND customer_name ILIKE '%${search}%'
       ORDER BY ${sort} DESC`,
      [req.user!.tenantId],
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

app.get("/invoices/:id", auth, async (req: AuthedRequest, res, next) => {
  try {
    const result = await pool.query("SELECT * FROM invoices WHERE id = $1", [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Not found" });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

app.post("/invoices", auth, async (req: AuthedRequest, res, next) => {
  try {
    const { customerName, customerEmail, amountCents, notes } = req.body;
    const result = await pool.query(
      `INSERT INTO invoices (tenant_id, customer_name, customer_email, amount_cents, notes, status)
       VALUES ($1, $2, $3, $4, $5, 'draft') RETURNING *`,
      [req.user!.tenantId, customerName, customerEmail, amountCents, notes],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

app.patch("/invoices/:id", auth, async (req: AuthedRequest, res, next) => {
  try {
    const fields = Object.keys(req.body);
    if (fields.length === 0) return res.status(400).json({ error: "Nothing to update" });
    const setClause = fields.map((f, i) => `${f} = $${i + 3}`).join(", ");
    const result = await pool.query(
      `UPDATE invoices SET ${setClause} WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, req.user!.tenantId, ...Object.values(req.body)],
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

app.get("/invoices/:id/view", auth, async (req: AuthedRequest, res, next) => {
  try {
    const result = await pool.query(
      "SELECT * FROM invoices WHERE id = $1 AND tenant_id = $2",
      [req.params.id, req.user!.tenantId],
    );
    const inv = result.rows[0];
    if (!inv) return res.status(404).send("Not found");
    res.send(`<!doctype html>
      <html><body>
        <h1>Invoice for ${inv.customer_name}</h1>
        <p>Amount: ${(inv.amount_cents / 100).toFixed(2)}</p>
        <div class="notes">${inv.notes}</div>
      </body></html>`);
  } catch (err) {
    next(err);
  }
});

app.delete("/invoices/:id", auth, async (req: AuthedRequest, res, next) => {
  try {
    await pool.query("DELETE FROM invoices WHERE id = $1 AND tenant_id = $2", [
      req.params.id,
      req.user!.tenantId,
    ]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  res.status(500).json({
    error: err.message,
    stack: err.stack,
    detail: err.detail,
    where: err.where,
    body: req.body,
  });
});

app.listen(3000, () => console.log("InvoiceLite listening on :3000"));
```

The schema:

```sql
CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
);
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer'))
);
CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  customer_name text NOT NULL,
  customer_email text NOT NULL,
  amount_cents integer NOT NULL,
  notes text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'void')),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

Business rules the original author intended but never enforced: only `owner` and `admin` may delete invoices, `viewer` is read-only, only draft invoices may be edited, and `status`/`paid_at` change only through the payment flow (which does not exist yet, so they must not be writable through the API at all).

The service contains **at least 8 distinct, deliberately planted vulnerabilities**, plus several weaker practices that a thorough reviewer will also flag. Some lines contain more than one problem. Some routes look safe but are not; some routes that look dangerous are fine. Do not assume a route is clean because it uses parameterized queries for some of its values.

## What to build

1. **Reproduce before you fix.** Bring the app up with Docker Postgres and two seeded tenants (Acme and Globex, each with an owner, a viewer and a few invoices). For every finding, write a concrete exploit as a `curl` command or a failing test: for example, "logged in as a Globex viewer, I read an Acme invoice". A finding without a reproduction is a guess.
2. **`SECURITY_REPORT.md`** with one entry per finding:
   - ID, title, OWASP Top 10 (2021) category
   - Severity: Critical / High / Medium / Low, with one sentence of justification (who can exploit it, what they get, how hard it is)
   - Location (route and original line numbers)
   - Reproduction steps
   - Fix description and the commit or PR that fixed it
   - The name of the regression test that proves it
   Order findings by severity. Add a short executive summary at the top that a non-engineer could read in one minute.
3. **Fixes.** Restructure the code as much as you need to. Expect to add `zod` for input validation, `argon2` for password hashing, `helmet`, `express-rate-limit`, environment-based configuration, and a central error handler that returns RFC 9457 problem details.
4. **Password migration.** Existing users have legacy hashes in the database. Design an upgrade path that does not force every user to reset their password, and document it in the report.
5. **Regression tests** with Vitest and supertest against a real Postgres test database (Docker or Testcontainers). Each finding gets at least one test that **fails against the original code and passes against the fixed code**. Tests must cover cross-tenant access with two real tenants, not a mocked repository.

## Constraints

- Keep Express and `pg`. The point is to fix the code, not to swap in a framework that hides the problems.
- All SQL must be parameterized. Anything that cannot be a parameter (column names, sort direction) goes through an allow-list.
- No secret may appear in source code or in git history after your fix commit. Explain in the report what you would do about the secrets that already leaked into history.
- The public API shape (routes and successful response bodies) should stay compatible, except where compatibility is itself the vulnerability. Note any breaking change in the report.
- Do not suppress findings with comments. If you consciously accept a risk, say so in the report with a reason.

## How to verify

- Check out the original commit, run your regression suite, and confirm every security test fails. Check out your final commit and confirm every test passes. Paste both summaries into the report.
- Run `npm audit --omit=dev` and fix or justify every high or critical advisory.
- Run `gitleaks detect` (or `trufflehog`) on the repository and record the result.
- Check response headers with `curl -I`: you should see a Content-Security-Policy, `Strict-Transport-Security` and `X-Content-Type-Options: nosniff`, and no `X-Powered-By`.
- Send 20 failed logins in a row for one account and confirm you receive `429` with a `Retry-After` header.
- Trigger a database error, for example by sending a malformed UUID, and confirm the response contains no stack trace, SQL, table names or request body, while your server log contains enough to debug it (with the password redacted).
