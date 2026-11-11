## What a strong solution looks like

A strong submission reads like a professional audit. Each finding comes with a working exploit, a severity someone could argue with, a fix in a named commit, and a regression test that fails on the original code and passes on the fix. The executive summary leads with the worst risk: anyone, without logging in, can reach other tenants' data.

Strong reviewers catch the lines that look harmless. `PATCH` parameterizes values but interpolates keys. The listing route filters by `tenant_id`, but `search` can escape that filter. The error handler echoes the request body, which contains the password on `/login`. They also fix the pattern rather than the individual line. One validation layer, one tenant-scoped data access path and one error handler mean the next route cannot repeat the bug.

## Reference approach

### Every planted vulnerability

Line numbers refer to the original `src/server.ts`.

| # | Finding | Location | Severity | Fix |
|---|---|---|---|---|
| 1 | SQL injection in login: `' OR 1=1 --` as email logs you in as the first user | `POST /login`, L56-57 | Critical | Query by email with a parameter, verify the hash in code |
| 2 | SQL injection in listing: `search` escapes the tenant filter (`%' OR '1'='1`, or `UNION` to dump `users`); `sort` is raw `ORDER BY` | `GET /invoices`, L79-80 | Critical | `ILIKE $2` with `%` added in code; allow-list sort column and direction |
| 3 | IDOR: lookup by id with no tenant filter | `GET /invoices/:id`, L91 | Critical | `AND tenant_id = $2`; return 404 |
| 4 | Mass assignment and SQL injection through body keys: writes `tenant_id`, `status`, `paid_at`, or injects via a key | `PATCH /invoices/:id`, L116-121 | Critical | zod `.strict()` schema, fixed column map, drafts only |
| 5 | Stored XSS: `customer_name` and `notes` unescaped | `GET /invoices/:id/view`, L138, L140 | High | Escape on output or auto-escaping templates; strict CSP |
| 6 | Unsalted MD5 password hashes | `hashPassword`, L21 | High | argon2id (m=19 MiB, t=2, p=1), rehash on login |
| 7 | Hard-coded JWT key and DB password | L8, L10 | High | zod-validated env; **rotate both** |
| 8 | No login rate limit; user enumeration via distinct messages | `POST /login`, L52-63 | High | `express-rate-limit` per IP and account; one generic message |
| 9 | Verbose errors: stack, pg `detail`/`where`, request body (passwords) in 500s; JWT error text in 401s | L159-166, L31 | Medium | Central problem+json handler; details only in server logs |
| 10 | No function-level authorization: `viewer` can create, edit, delete; paid invoices deletable | L99, L113, L147 | High | `requireRole` checks; viewer read-only; void instead of delete |
| 11 | JWT without `exp`, pinned `algorithms`, `iss`/`aud` | L28, L66 | Medium | `expiresIn: "15m"`, `algorithms: ["HS256"]`, issuer/audience |
| 12 | Signup returns `password_hash` and accepts `role` | `POST /signup`, L43-46 | Medium | Return a DTO; new tenant creator is always `owner` |
| 13 | Passwords logged by `console.log(req.body)` | L54 | Medium | Structured logger with `redact` |
| 14 | CORS reflects any origin with credentials; no security headers | L14 | Low (High once cookies are used) | Origin allow-list; `helmet()` |
| 15 | No validation on create: negative or string `amountCents`, unbounded strings | `POST /invoices`, L101 | Low | zod with `int().positive()` and `max()` |

Findings 1-8 are the required core. A submission that also finds 9-12 is thorough, and 13-15 show real care.

### Key fixes

The tenant-scoped update makes mass assignment impossible because only known fields can be mapped to columns:

```ts
const UpdateInvoice = z
  .object({
    customerName: z.string().min(1).max(200),
    customerEmail: z.string().email().max(320),
    amountCents: z.number().int().positive().max(100_000_000),
    notes: z.string().max(5000).nullable(),
  })
  .partial()
  .strict();

const COLUMNS = {
  customerName: "customer_name",
  customerEmail: "customer_email",
  amountCents: "amount_cents",
  notes: "notes",
} as const;

const patch = UpdateInvoice.parse(req.body);
const entries = Object.entries(patch) as [keyof typeof COLUMNS, unknown][];
const set = entries.map(([k], i) => `${COLUMNS[k]} = $${i + 3}`).join(", ");
const { rows } = await pool.query(
  `UPDATE invoices SET ${set}
   WHERE id = $1 AND tenant_id = $2 AND status = 'draft' RETURNING *`,
  [id, user.tenantId, ...entries.map(([, v]) => v)],
);
```

The password upgrade path avoids forcing a reset. On a successful login, if the stored hash is a legacy MD5 hash, verify it, then replace it with argon2id in the same request:

```ts
const isLegacy = /^[a-f0-9]{32}$/.test(row.password_hash);
const ok = isLegacy
  ? crypto.timingSafeEqual(Buffer.from(md5(password)), Buffer.from(row.password_hash))
  : await argon2.verify(row.password_hash, password);
if (ok && isLegacy) await users.updateHash(row.id, await argon2.hash(password, { type: argon2.argon2id }));
```

Another option is to wrap every legacy hash right away as `argon2id(md5(password))`. The weak hashes are then gone today, without waiting for each user to log in again.

### Regression tests

```ts
it("Globex viewer cannot read an Acme invoice (IDOR)", async () => {
  const res = await request(app).get(`/invoices/${acmeInvoice.id}`).set(auth(globexViewer));
  expect(res.status).toBe(404);
});

it("login rejects SQL injection in email", async () => {
  const res = await request(app).post("/login").send({ email: "' OR 1=1 --", password: "x" });
  expect(res.status).toBe(401);
});

it("PATCH cannot change tenant_id or status", async () => {
  const res = await request(app).patch(`/invoices/${draft.id}`).set(auth(acmeOwner))
    .send({ tenant_id: globex.id, status: "paid" });
  expect(res.status).toBe(400);
  const { rows } = await db.query("SELECT tenant_id, status FROM invoices WHERE id = $1", [draft.id]);
  expect(rows[0]).toEqual({ tenant_id: acme.id, status: "draft" });
});


```

Add similar tests for each remaining finding. Examples: the HTML view escapes `<script>`, a viewer's DELETE returns 403, the 21st login returns 429, and an error response contains no stack trace or SQL. A malformed `:id` should be rejected by UUID validation before any query runs.

## Common mistakes

- **Fixing only the line that was pointed at.** Parameterizing `search` but leaving `ORDER BY ${sort}` is still injectable. Identifiers need an allow-list.
- **Returning 403 for another tenant's invoice.** That confirms the id exists. Use 404.
- **Deleting the secrets from the file and calling it done.** They are still in git history. Rotate both the JWT key (which logs everyone out) and the database password. Rewriting history is optional; rotation is not.
- **Severity by vibes.** If everything is Critical, the report is useless. Rate each finding by who can exploit it, what they gain, and how much effort it takes.
- **Tests that mock the database.** IDOR and injection live in SQL text, which mocks never run.
- **Escaping on input.** Storing `&lt;` corrupts data for the JSON API and PDF export. Escape on output, for the context the value lands in.

## Trade-offs worth discussing

- **Rate limiting per IP or per account.** Credential stuffing spread over many IPs gets past per-IP limits, while per-account lockouts let an attacker lock out a victim. Combine them: limit per IP, back off per account instead of locking it, and alert.
- **Short-lived JWTs vs server sessions.** You cannot revoke a JWT instantly, but you can delete a server-side session. For a 40-tenant B2B app, opaque sessions are simpler and safer.
- **Hand-written escaping vs a template engine.** The next developer will forget `escapeHtml`. Auto-escaping plus CSP is defense in depth.
- **Postgres row-level security as a second line of defense** against the next missing `tenant_id` filter, at some pooling complexity.

## Grade yourself

| Dimension | Strong | Acceptable | Needs work |
|---|---|---|---|
| Coverage | All 8 core findings plus at least 4 of the extras (9-15) | All 8 core findings | Missed any of IDOR, either SQL injection, or mass assignment |
| Evidence | Every finding has a reproduction command or a failing test | Most findings reproduced | Findings asserted without proof |
| Severity | Justified by attacker, impact and effort; ordering defensible | Reasonable severities without justification | Everything rated the same |
| Fixes | Systemic: zod at the boundary, a tenant-scoped data path, a central error handler, argon2id with migration | Each issue fixed locally | Some fixes incomplete (for example the sort column still interpolated) |
| Regression tests | Each test fails on the original commit and passes on the fix, with two real tenants on real Postgres | Tests pass on the fix but were never run against the original | Few tests or a mocked database |
| Secrets | Moved to env, rotated, gitleaks clean, history plan documented | Moved to env only | Still in source |

## Going further

- Add Postgres row-level security and prove the IDOR test still passes with the application filter removed.
- Run Semgrep and gitleaks in CI on every PR; check which findings they would have caught.
- Threat-model (STRIDE) the payment flow before anyone builds it.
