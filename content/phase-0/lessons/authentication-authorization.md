## Why this matters

Two of the most expensive bugs a SaaS company can ship are "anyone can log in as anyone" and "tenant A can see tenant B's invoices." The first is an authentication failure, the second an authorization failure. Both are usually caused not by broken cryptography but by small, ordinary decisions: a JWT that never expires, a password hashed with SHA-256, a repository method that forgot `WHERE tenant_id = $1`, or a permission check that lives only in the React component that hides the button.

This lesson separates the two concerns cleanly, compares the common mechanisms with their real trade-offs, and shows where each check belongs in a layered architecture so that it cannot be skipped.

- **Authentication (authN)**: who are you? Proving identity: password, SSO, passkey, API key, service credential.
- **Authorization (authZ)**: what are you allowed to do, on which resource, in which tenant?

## Sessions vs JWTs

After login, the server needs a way to recognize subsequent requests. Two broad options:

```
Server-side session                         Self-contained token (JWT)
-------------------                         --------------------------
Cookie: sid=opaque-random-256-bit           Authorization: Bearer eyJhbGciOi...
        |                                           |
        v                                           v
  sessions table / Redis                      verify signature + exp
  -> user_id, tenant_id, expires              -> claims inside the token
```

| | Server-side session | JWT access token |
|---|---|---|
| Revocation | Instant: delete the row | Hard: valid until `exp` unless you add a denylist |
| Lookup cost | One store read per request | Signature check only |
| Size | Small cookie | Larger, grows with claims |
| Stale data | Always current | Claims (roles) frozen until refresh |
| Best fit | Browser apps on your own domain | Service-to-service, APIs used by many services, mobile with short-lived tokens |

For a typical Next.js or Express SaaS serving its own browser frontend, **a server-side session in an HttpOnly cookie is the safer default**. JWTs make sense when many independent services must verify identity without calling a central store, and then they should be short-lived (5–15 minutes) and paired with a refresh token that is stored server-side and rotated on use.

```ts
// Bad: long-lived JWT in localStorage, readable by any XSS payload,
// containing roles that stay valid for 30 days after being revoked
const token = jwt.sign({ userId, tenantId, role: "admin" }, "secret123", { expiresIn: "30d" });
localStorage.setItem("token", token);
```

```ts
// Better: opaque session ID in a hardened cookie
import { randomBytes, createHash } from "node:crypto";

const sessionId = randomBytes(32).toString("base64url");
await db.query(
  `INSERT INTO sessions (id_hash, user_id, tenant_id, expires_at)
   VALUES ($1, $2, $3, now() + interval '12 hours')`,
  [createHash("sha256").update(sessionId).digest("hex"), user.id, user.tenantId],
);

res.cookie("__Host-sid", sessionId, {
  httpOnly: true,     // not readable from JavaScript
  secure: true,       // HTTPS only
  sameSite: "lax",    // not sent on cross-site POSTs: blocks most CSRF
  path: "/",          // __Host- prefix requires Secure, Path=/, no Domain
  maxAge: 12 * 60 * 60 * 1000,
});
```

Storing only a hash of the session ID means a leaked database backup does not hand out live sessions. Rotate the session ID on login and on privilege change (prevents session fixation), and give sessions both an idle timeout and an absolute lifetime.

If you do use JWTs, verify them strictly: pin the algorithm, check `iss`, `aud` and `exp`, and never accept `alg: none`.

```ts
import { jwtVerify, createRemoteJWKSet } from "jose";

const JWKS = createRemoteJWKSet(new URL("https://auth.acme-erp.com/.well-known/jwks.json"));

const { payload } = await jwtVerify(token, JWKS, {
  issuer: "https://auth.acme-erp.com",
  audience: "invoices-api",
  algorithms: ["RS256"],
});
```

## Password hashing

Passwords must be stored with a slow, salted, memory-hard function so that a stolen database cannot be brute-forced cheaply. General-purpose hashes (MD5, SHA-1, SHA-256) are designed to be fast; a GPU computes billions per second.

| Algorithm | Status |
|---|---|
| MD5, SHA-1, SHA-256 (even salted) | Never for passwords |
| PBKDF2 | Acceptable when FIPS compliance requires it, with very high iterations |
| bcrypt | Acceptable for existing systems; cost 10+; truncates input at 72 bytes |
| scrypt | Good |
| Argon2id | Recommended first choice (OWASP Password Storage Cheat Sheet) |

OWASP's minimum Argon2id configuration is 19 MiB of memory, 2 iterations, parallelism 1. Tune upward until hashing takes a few hundred milliseconds on your hardware.

```ts
// Bad
const hash = createHash("sha256").update(password).digest("hex");

// Better (npm package "argon2")
import argon2 from "argon2";

const hash = await argon2.hash(password, {
  type: argon2.argon2id,
  memoryCost: 19456, // KiB = 19 MiB
  timeCost: 2,
  parallelism: 1,
});
const ok = await argon2.verify(hash, attempt); // salt and params are encoded in the hash
```

The encoded hash stores its parameters, so you can raise them later and re-hash on the user's next successful login. Also: rate limit login attempts per account and per IP, return the same error for "unknown email" and "wrong password", check new passwords against breached-password lists, and prefer length (at least 8 characters, ideally more) over composition rules, as NIST SP 800-63B recommends.

## OAuth 2.0 and OpenID Connect

These two are constantly confused:

- **OAuth 2.0** is about **delegated authorization**: letting an app access an API on a user's behalf ("let Acme ERP read your Google Drive"). It yields an access token.
- **OpenID Connect (OIDC)** is an identity layer on top of OAuth 2.0: it adds an **ID token** (a JWT about who logged in) and standard discovery. This is what "Sign in with Google" or enterprise SSO via Okta or Microsoft Entra ID uses.

For a web app the flow to use is **Authorization Code with PKCE**. The implicit flow is deprecated.

```
 Browser              Your app (backend)             Identity provider (IdP)
    |  click "Sign in with SSO"  |                              |
    |--------------------------->| generate state, nonce,       |
    |                            | code_verifier; store them    |
    |<--- 302 to IdP /authorize?client_id&redirect_uri&         |
    |     scope=openid email&state&nonce&code_challenge -------->|
    |                      user authenticates (+ MFA) at IdP     |
    |<---------------- 302 to redirect_uri?code=...&state=... ---|
    |--------------------------->| check state matches          |
    |                            |-- POST /token (code,         |
    |                            |   code_verifier, client auth)->|
    |                            |<-- id_token, access_token ----|
    |                            | verify id_token: sig, iss,   |
    |                            | aud, exp, nonce              |
    |                            | map (iss, sub) -> user,      |
    |<--- Set-Cookie: session ---| create local session         |
```

Practical rules:

- Identify users by the pair `(iss, sub)`, not by email. Emails change and can be reused.
- Validate `state` (CSRF on the callback) and `nonce` (replay of ID tokens).
- After SSO, create **your own** session. Do not use the IdP's access token as your app's session.
- For enterprise tenants, map the IdP to the tenant (`tenant.sso_issuer`), and enforce "users of this tenant must log in via SSO" server-side.
- Use a library (`openid-client`, Auth.js, or a managed provider like Auth0, Clerk, WorkOS) rather than hand-rolling the protocol.

For machine-to-machine calls, OAuth's **client credentials** grant issues a token to a service rather than a user.

## MFA

Multi-factor authentication combines something you know with something you have or are. Ranked roughly from weakest to strongest:

| Factor | Notes |
|---|---|
| SMS codes | Better than nothing; vulnerable to SIM swap and phishing |
| TOTP apps | Good; still phishable by a real-time proxy |
| WebAuthn / passkeys | Phishing-resistant because the credential is bound to the origin |

Implementation details that matter: store TOTP secrets encrypted, accept a code only once, give users single-use recovery codes (hashed like passwords), require re-authentication before disabling MFA or changing email, and let tenant admins enforce MFA for their users.

## RBAC vs ABAC

**Role-based access control (RBAC)**: users get roles, roles grant permissions.

```ts
const permissions = {
  owner:      ["invoice:read", "invoice:create", "invoice:finalize", "invoice:void", "user:manage"],
  accountant: ["invoice:read", "invoice:create", "invoice:finalize"],
  viewer:     ["invoice:read"],
} as const;
```

**Attribute-based access control (ABAC)**: decisions depend on attributes of the user, resource and context. "Accountants may finalize invoices under 10,000 EUR; above that, only owners." "Sales reps may read invoices only for customers they own."

| | RBAC | ABAC |
|---|---|---|
| Model | Role to permission table | Policy over attributes |
| Easy to audit | Yes | Harder |
| Expressiveness | Coarse | Fine-grained |
| Typical use | Most SaaS admin/member/viewer setups | Approval limits, ownership, regions |

In practice you combine them: RBAC for the baseline, plus a few attribute rules written as code. Policy engines (OPA, Cedar, Oso) or relationship-based systems (OpenFGA, inspired by Google Zanzibar) help when rules multiply.

In multi-tenant SaaS, roles are **per tenant**: the same person may be an owner in one company and a viewer in another. Store memberships as `(user_id, tenant_id, role)`, not a single `users.role` column.

## Multi-tenant authorization

The most common critical bug in B2B SaaS is an insecure direct object reference across tenants:

```ts
// Bad: any logged-in user can read any tenant's invoice by guessing or
// harvesting an ID
app.get("/v1/invoices/:id", requireLogin, async (req, res) => {
  const { rows } = await db.query("SELECT * FROM invoices WHERE id = $1", [req.params.id]);
  res.json(rows[0]);
});
```

```ts
// Better: tenant comes from the session, never from the client, and
// every query is scoped
app.get("/v1/invoices/:id", requireLogin, async (req, res) => {
  const { tenantId } = req.auth; // set by auth middleware from the session
  const invoice = await invoiceRepo.findById(tenantId, req.params.id);
  if (!invoice) throw notFound(); // 404, not 403: do not confirm existence
  res.json(toDto(invoice));
});
```

Make the safe path the only path: repository methods require `tenantId` as the first argument, and there is no unscoped `findById(id)`. Then add defense in depth with Postgres **row-level security**, so a forgotten `WHERE` still returns nothing:

```sql
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON invoices
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
```

```ts
// Per request, inside a transaction, on a role that is NOT the table owner
// and does not have BYPASSRLS
await tx.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
```

`set_config(..., true)` scopes the setting to the transaction, which matters with connection pooling: a session-level setting could leak to the next request that reuses the connection.

## Where checks live in a layered architecture

```
  HTTP layer (route/controller)
    - authenticate: session/JWT -> principal { userId, tenantId, roles }
    - reject unauthenticated (401); coarse checks like "is a member"
        |
  Application layer (use cases)
    - authorize the action: can(principal, "invoice:finalize", invoice)
    - business rules, including attribute rules (amount limits, ownership)
        |
  Infrastructure (repositories, DB)
    - tenant scoping on every query; RLS as the safety net
```

The UI hides buttons for usability only. Security checks happen on the server, in the use case, because use cases are called from multiple entry points (HTTP, background jobs, CLI scripts, imports) and each must enforce the same rule.

```ts
export class FinalizeInvoice {
  constructor(private invoices: InvoiceRepository, private authz: Authorizer) {}

  async execute(principal: Principal, invoiceId: string) {
    const invoice = await this.invoices.findById(principal.tenantId, invoiceId);
    if (!invoice) throw new NotFoundError("invoice");
    this.authz.assert(principal, "invoice:finalize", invoice); // RBAC + amount limit
    invoice.finalize();
    await this.invoices.save(principal.tenantId, invoice);
  }
}
```

### Service-to-service

Internal services should authenticate each other too ("the network is private" is not a security boundary). Options: OAuth client credentials with short-lived JWTs scoped by audience, mTLS within a service mesh, or cloud workload identity. Propagate the tenant and user context explicitly, and have the receiving service re-check tenant scope rather than trusting a caller's claim blindly.

## Common mistakes

- Checking permissions only in the frontend.
- Trusting `tenantId` from the request body, query string or a header the client controls.
- Long-lived JWTs with roles baked in, with no way to revoke when someone leaves.
- Storing tokens in `localStorage`, where any XSS can read them.
- Hashing passwords with SHA-256, or bcrypt with a cost of 4.
- Identifying SSO users by email instead of `(iss, sub)`, allowing account takeover when an IdP lets users set arbitrary emails.
- A single global `role` column in a product where users belong to many tenants.
- Returning 403 for another tenant's resource, which confirms that the ID exists.

## In the real world

Most SaaS teams buy authentication (Auth0, Clerk, WorkOS, Cognito, Keycloak, or Auth.js plus an IdP) and build authorization themselves, because authorization is tied to the domain. Enterprise customers will ask for SAML or OIDC SSO, SCIM user provisioning, enforced MFA and audit logs of permission changes; these are often what moves a deal from a pilot to a contract.

In interviews you will be asked to compare sessions and JWTs, explain OAuth vs OIDC, and design permissions for a multi-tenant product. A strong answer names the threat each choice addresses, places checks in specific layers, and mentions defense in depth such as RLS.

## Try it

In an existing project, grep every query against a tenant-owned table and confirm each one filters by tenant. Then write an integration test that creates two tenants, logs in as a user of tenant A, requests one of tenant B's invoices by ID, and asserts a 404. Finally, check how your passwords are hashed and whether your session cookie has `HttpOnly`, `Secure` and `SameSite` set.
