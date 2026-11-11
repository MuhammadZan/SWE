## Why this matters

Most SaaS breaches are not clever. A support engineer changes `/invoices/1041` to `/invoices/1042` in the URL and sees another company's invoice. A search box concatenates input into SQL. A `.env` file with the production Stripe key ends up in a public repo. None of these need a nation-state attacker, and every one of them has ended up in a disclosure email that a real company had to send to its customers.

The OWASP Top 10 is a ranked list of the risk categories that cause most real-world web breaches. The 2021 edition is the one most tools and audits reference (an updated 2025 edition has been published; the categories are largely the same, with access control still at the top). This lesson walks through the categories that matter most for a multi-tenant TypeScript SaaS, each with vulnerable code and the fix.

| OWASP 2021 category | What it looks like in your invoice app |
|---|---|
| A01 Broken Access Control | IDOR on `/invoices/:id`, missing tenant filter, CSRF |
| A02 Cryptographic Failures | Plain or MD5 password hashes, HTTP without TLS |
| A03 Injection | SQL injection, XSS (XSS is grouped under injection in 2021) |
| A04 Insecure Design | No rate limit on login, no idempotency on payments |
| A05 Security Misconfiguration | Stack traces in responses, missing headers, open CORS |
| A06 Vulnerable Components | Outdated packages with known CVEs |
| A07 Identification and Auth Failures | Weak sessions, credential stuffing |
| A08 Software and Data Integrity Failures | Unsafe deserialization, unsigned webhooks |
| A09 Logging and Monitoring Failures | No audit trail, or logs full of PII |
| A10 SSRF | "Import logo from URL" fetching internal metadata endpoints |

## Broken access control and IDOR

IDOR (insecure direct object reference) means the server trusts an identifier from the client without checking that the caller may access that object. Authentication proves who you are; it says nothing about whether invoice 1042 is yours.

```ts
// Vulnerable: any logged-in user can read any tenant's invoice
app.get("/invoices/:id", requireAuth, async (req, res) => {
  const { rows } = await db.query("SELECT * FROM invoices WHERE id = $1", [req.params.id]);
  res.json(rows[0]);
});
```

```ts
// Fixed: tenant comes from the session, never from the request; 404 hides existence
app.get("/invoices/:id", requireAuth, async (req, res) => {
  const { rows } = await db.query(
    "SELECT id, number, total_cents, status FROM invoices WHERE id = $1 AND tenant_id = $2",
    [req.params.id, req.user.tenantId],
  );
  if (!rows[0]) return res.status(404).json({ title: "Not found" });
  res.json(rows[0]);
});
```

UUIDs instead of sequential IDs make guessing harder, but they are not access control: IDs leak through logs, emails and shared links. The tenant filter is the control. Defense in depth adds Postgres row-level security so a forgotten `WHERE` still returns nothing.

### Mass assignment

A related access-control bug: spreading the request body into an update.

```ts
// Vulnerable: attacker sends { "role": "owner", "tenantId": "other" }
await db.users.update({ where: { id: req.user.id }, data: req.body });

// Fixed: an explicit allowlist schema
const UpdateProfile = z.object({ name: z.string().min(1).max(100), locale: z.enum(["en", "de", "fr"]) }).strict();
const data = UpdateProfile.parse(req.body);
await db.users.update({ where: { id: req.user.id }, data });
```

`.strict()` rejects unknown keys instead of silently dropping them, which also surfaces buggy clients.

## Injection: SQL and XSS

SQL injection happens whenever input becomes part of the query text instead of a bound parameter.

```ts
// Vulnerable: ?status=paid' OR '1'='1 returns every tenant's rows
const sql = `SELECT * FROM invoices WHERE tenant_id = '${tenantId}' AND status = '${req.query.status}'`;

// Fixed: parameters are sent separately from the SQL text
await db.query("SELECT * FROM invoices WHERE tenant_id = $1 AND status = $2", [tenantId, status]);
```

Parameters cannot be used for identifiers like column names. For a dynamic `ORDER BY`, map input to an allowlist:

```ts
const SORTS = { date: "issued_at", total: "total_cents" } as const;
const col = SORTS[req.query.sort as keyof typeof SORTS] ?? "issued_at";
```

ORMs (Prisma, Drizzle) parameterize by default, but their raw escape hatches (`$queryRawUnsafe`, `sql.raw`) bring the bug back.

XSS is injection into HTML. React escapes text by default, so the danger is in the escape hatches: `dangerouslySetInnerHTML`, server-rendered HTML strings, and `href` values.

```tsx
// Vulnerable: invoice notes from a customer rendered as HTML
<div dangerouslySetInnerHTML={{ __html: invoice.notes }} />
<a href={customer.website}>Website</a> {/* javascript:alert(1) works */}

// Fixed
import DOMPurify from "isomorphic-dompurify";
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(invoice.notesHtml) }} />
const safeUrl = /^https?:\/\//i.test(customer.website) ? customer.website : undefined;
<a href={safeUrl} rel="noopener noreferrer">Website</a>
```

In Express templates or email HTML built from strings, escape every interpolated value. A Content Security Policy (below) is the second line of defense.

## CSRF

If you authenticate with cookies, the browser attaches them to requests from any site. A malicious page can submit a form to `POST /invoices/1042/void`.

Defenses, in order of importance:

1. `SameSite=Lax` (or `Strict`) session cookies. Modern browsers default to Lax, but set it explicitly.
2. Never change state on `GET`.
3. For state-changing requests, require a CSRF token or a custom header (for example `X-Requested-With`) that cross-site forms cannot set, and verify `Origin`.

```ts
res.cookie("sid", sessionId, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });

app.use((req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("origin");
  if (origin && origin !== process.env.APP_ORIGIN) return res.status(403).end();
  next();
});
```

Pure bearer-token APIs (Authorization header, no cookies) are not CSRF-prone, but then the token lives in JavaScript and XSS can steal it. That is the trade-off.

## SSRF

Server-side request forgery: your server fetches a URL the attacker controls. Features like "import logo from URL" or "webhook endpoint" are the classic entry points. On cloud hosts, `http://169.254.169.254/` is the instance metadata service, which can hand out credentials.

```ts
// Vulnerable
const img = await fetch(req.body.logoUrl);

// Better: validate scheme, resolve DNS, block private ranges, no redirects, timeout
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";

async function safeFetch(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("https only");
  const { address } = await lookup(url.hostname);
  if (ipaddr.parse(address).range() !== "unicast") throw new Error("blocked address");
  return fetch(url, { redirect: "error", signal: AbortSignal.timeout(5000) });
}
```

This check still has a DNS-rebinding gap (the name can resolve differently on the second lookup). The robust fix is an egress proxy that enforces the block list, or pinning the resolved IP for the connection.

## Insecure deserialization and integrity

JSON.parse is safe on its own, but turning untrusted data into objects with behavior is not: `node-serialize`, YAML loaders with custom tags, or merging user JSON into objects (prototype pollution via `__proto__`).

```ts
// Vulnerable: deep merge of user-controlled JSON pollutes Object.prototype
deepMerge(settings, JSON.parse(req.body.prefs));

// Fixed: validate the shape first; zod strips unknown keys including __proto__
const prefs = PrefsSchema.parse(JSON.parse(req.body.prefs));
```

Integrity also covers webhooks: verify the provider's signature (Stripe's `constructEvent`, HMAC with `crypto.timingSafeEqual`) on the raw body before trusting any field.

## Misconfiguration and security headers

Verbose errors are free reconnaissance for attackers.

```ts
// Vulnerable
app.use((err, req, res, next) => res.status(500).json({ error: err.message, stack: err.stack }));

// Fixed: log the detail, return a generic problem with a correlation id
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  const id = crypto.randomUUID();
  logger.error({ err, requestId: id }, "unhandled");
  res.status(500).type("application/problem+json").json({ title: "Internal error", status: 500, requestId: id });
});
```

`helmet` sets sensible headers in one line; tune the CSP for your app.

```ts
import helmet from "helmet";
app.use(helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"] } },
  strictTransportSecurity: { maxAge: 63072000, includeSubDomains: true },
}));
app.disable("x-powered-by");
```

| Header | Protects against |
|---|---|
| Content-Security-Policy | XSS impact, clickjacking (`frame-ancestors`) |
| Strict-Transport-Security | TLS downgrade, cookie theft on HTTP |
| X-Content-Type-Options: nosniff | MIME sniffing of uploads |
| Referrer-Policy | Leaking URLs with tokens to third parties |

Also: CORS with an explicit origin list (never reflect any origin with credentials), debug endpoints off in production, default credentials removed.

## Secrets management

```ts
// Vulnerable: committed forever in git history
const stripe = new Stripe("sk_live_51H...");
const JWT_SECRET = "changeme";

// Fixed: injected at runtime, validated at boot
const Env = z.object({ STRIPE_SECRET_KEY: z.string().startsWith("sk_"), JWT_SECRET: z.string().min(32) });
export const env = Env.parse(process.env);
```

Store secrets in a secret manager (AWS Secrets Manager, GCP Secret Manager, Doppler, Vault) or your platform's encrypted env vars. Add `.env` to `.gitignore`, enable GitHub secret scanning and push protection, and if a secret is ever committed, **rotate it**: deleting the commit does not un-leak it.

## Vulnerable dependencies

A typical Next.js app pulls in over a thousand transitive packages. Run `npm audit --omit=dev` in CI and let Dependabot open update PRs:

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    groups:
      minor-and-patch:
        update-types: ["minor", "patch"]
```

Commit the lockfile, use `npm ci` in CI, and treat a red audit on a reachable, high-severity advisory as a blocking bug. Not every advisory is exploitable in your usage; triage, do not blindly ignore.

## Rate limiting and authentication

No rate limit on `/login` means credential stuffing at thousands of guesses per minute.

```ts
import { rateLimit } from "express-rate-limit";
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false });
app.post("/auth/login", loginLimiter, login);
```

The default store is in memory, so with multiple instances use a shared store (for example `rate-limit-redis`). Limit per account as well as per IP, since attackers rotate IPs. Hash passwords with argon2id or bcrypt, never SHA-256 or MD5:

```ts
// Vulnerable: fast hash, GPU-crackable in hours
crypto.createHash("md5").update(password).digest("hex");
// Fixed
import argon2 from "argon2";
const hash = await argon2.hash(password, { type: argon2.argon2id });
const ok = await argon2.verify(hash, attempt);
```

## Input validation with zod

Validate at the boundary: every request body, query string, header you read, and webhook payload. TypeScript types vanish at runtime; a `req.body as CreateInvoice` cast checks nothing.

```ts
const CreateInvoice = z.object({
  customerId: z.string().uuid(),
  currency: z.enum(["USD", "EUR", "GBP"]),
  lines: z.array(z.object({ description: z.string().max(500), quantityMilli: z.number().int().positive(), unitPriceCents: z.number().int().nonnegative() })).min(1).max(200),
}).strict();

const parsed = CreateInvoice.safeParse(req.body);
if (!parsed.success) return res.status(422).json({ title: "Validation failed", errors: parsed.error.issues });
```

Limits (`max(500)`, `max(200)`) are security controls too: they bound memory and CPU per request. Also set `express.json({ limit: "100kb" })`.

## Logging without leaking PII

You need logs to detect attacks (failed logins, 403 spikes, authorization denials) but logs are often the least protected data store you own.

```ts
// Vulnerable
logger.info({ body: req.body, headers: req.headers }, "login attempt");

// Fixed: structured, redacted, with identifiers rather than personal data
const logger = pino({ redact: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.email"] });
logger.warn({ userId, tenantId, ip: req.ip, event: "login_failed" }, "login failed");
```

Never log passwords, tokens, full card numbers, or session cookies. Keep an append-only audit log for security-relevant actions (role changes, exports, API key creation).

## Common mistakes

- **Checking authentication but not authorization.** `requireAuth` on every route and zero ownership checks is the most common SaaS vulnerability.
- **Trusting `tenantId` from the body or URL** instead of the authenticated session or token.
- **Blocklisting** (`input.replace("<script>", "")`) instead of escaping, parameterizing and allowlisting.
- **Relying on the frontend** to hide buttons. The API must enforce every rule; attackers use curl.
- **In-memory rate limits** behind a load balancer with five instances, which multiplies the limit by five and resets on deploy.
- **Deleting a leaked secret from git** without rotating it.
- **Returning 403 vs 404 inconsistently**, which lets attackers enumerate which IDs exist.

## In the real world

Security reviews at SaaS companies focus on access control first because it is the most common and highest-impact finding in penetration tests. Mature teams centralize tenant scoping in a repository layer or Postgres RLS so it cannot be forgotten per query, run SAST (CodeQL, Semgrep) and dependency scanning on every PR, and enforce headers at the edge (CDN or reverse proxy) as well as in the app. Enterprise customers will send security questionnaires (SOC 2, ISO 27001) asking exactly these questions: how do you store passwords, rotate secrets, scan dependencies, and isolate tenants.

In interviews, expect "how would you prevent one tenant from seeing another's data?" A strong answer layers it: tenant from the token, scoped queries in one place, RLS as a backstop, tests that try cross-tenant access, and audit logging.

## Try it

Take an existing Express or Next.js route handler from one of your projects and audit it in 30 minutes:

1. List every identifier the handler reads from the request. For each, write down where ownership is checked.
2. Grep for template literals near `query(`, `$queryRawUnsafe` and `dangerouslySetInnerHTML`.
3. Run `curl -sI https://your-app` and compare the headers against the table above.
4. Run `npm audit --omit=dev` and triage the top three findings.
5. Write one failing test where user A requests user B's resource, then fix the code until it returns 404.
