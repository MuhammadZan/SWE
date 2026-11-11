## What a strong solution looks like

A strong capstone looks like a small production service, not a tutorial project. When you open the repo, the README explains the architecture in a paragraph, links the diagram, the contract and the ADRs, and gets you from clone to green tests with `docker compose up` and two commands.

The pull request history tells a story. Six to ten PRs, each doing one thing, each with a description stating why, what, risk and how to test, each with green checks and at least one review comment that was addressed. Branch protection prevents anyone, including the author, from pushing to `main`.

In the code, security is structural rather than sprinkled. Tenant id enters once, from the session. Every repository method requires it. Authorization is a tested policy function called from use cases. Every input passes a strict schema. Every error leaves through one problem-details handler. The tests are organized around guarantees ("no route leaks across tenants", "viewer cannot write", "errors never include stack traces"), and they would catch a regression introduced by a new route.

## Reference approach

### Structure and middleware order

```
src/
  http/        app.ts (middleware), routes/, problem.ts, schemas/
  application/ use-cases/ (CreateInvoice, FinalizeInvoice, ...), policy.ts
  domain/      invoice.ts (state machine), money.ts
  infra/       db.ts (withTenant), repositories/, rate-limit-store.ts, sessions.ts
  config.ts    zod-validated env
docs/adr/      0001-sessions-over-jwt.md, 0002-rls-defense-in-depth.md, 0003-idempotency-in-postgres.md
```

```ts
app.set("trust proxy", 1);                 // exactly one known proxy hop
app.use(requestId());                      // sets req.id, echoes X-Request-Id
app.use(helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true },
}));
app.use(express.json({ limit: "100kb" }));
app.use(pinoHttp({ logger, redact: ["req.headers.authorization", "req.headers.cookie",
  "req.body.password", "req.body.totp", "*.email"] }));
app.use("/v1/auth/login", loginLimiter);   // 5 per 15 min, key = ip + email, Redis store
app.use(session());                        // loads principal from __Host-sid
app.use(csrfOriginCheck(config.APP_ORIGIN)); // reject state-changing requests from other origins
app.use("/v1", requireAuth, writeLimiter, routes);
app.use(notFoundProblem);
app.use(problemHandler);                   // the only place errors become responses
```

The order matters. Security headers go first, so even early errors carry them. Body size limits come before parsing. The login limiter runs before authentication. The problem handler comes last.

### Tenant context reaches the database once

```ts
export async function withTenant<T>(tenantId: string, fn: (tx: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
```

Repositories still include `WHERE tenant_id = $1`. RLS is the safety net, not the primary mechanism, because explicit filters also help the planner use `(tenant_id, ...)` indexes.

### Authorization in the use case

```ts
const matrix: Record<Role, Permission[]> = {
  owner: ["invoice.read", "invoice.create", "invoice.finalize", "invoice.void", "users.manage"],
  accountant: ["invoice.read", "invoice.create", "invoice.finalize", "invoice.void"],
  viewer: ["invoice.read"],
};

export class FinalizeInvoice {
  constructor(private invoices: InvoiceRepository) {}
  async execute(p: Principal, id: string) {
    if (!can(p, "invoice.finalize")) throw new ForbiddenError();
    const invoice = await this.invoices.get(p.tenantId, id);
    if (!invoice) throw new NotFoundError();          // also covers other tenants
    invoice.finalize();                               // domain enforces draft -> open
    await this.invoices.save(p.tenantId, invoice);
    return invoice;
  }
}
```

```ts
describe.each([
  ["owner", "invoice.finalize", true],
  ["accountant", "invoice.finalize", true],
  ["viewer", "invoice.finalize", false],
  ["viewer", "invoice.read", true],
  // ...every role x action
])("%s %s", (role, action, allowed) => {
  it(`is ${allowed ? "allowed" : "denied"}`, () =>
    expect(can(principal(role as Role), action as Permission)).toBe(allowed));
});
```

### Cross-tenant test generated from the contract

```ts
const ops = listOperations(loadYaml("openapi.yaml"))
  .filter((op) => op.path.includes("{id}"));

it.each(ops)("$method $path returns 404 across tenants", async (op) => {
  const res = await request(app)[op.method](op.path.replace("{id}", tenantAInvoiceId))
    .set("Cookie", tenantBSession).set("Idempotency-Key", randomUUID()).send({});
  expect(res.status).toBe(404);
  expect(res.headers["content-type"]).toMatch(/application\/problem\+json/);
});
```

Generating the cases from the contract means a new route automatically gets the test.

### Problem handler

```ts
export const problemHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const p = toProblem(err); // maps ValidationError, NotFoundError, ForbiddenError, ConflictError, RateLimitError
  if (p.status >= 500) req.log.error({ err }, "unhandled error");
  res.status(p.status).type("application/problem+json").json({ ...p, instance: `urn:request:${req.id}` });
};
```

`toProblem` never copies `err.message` from unknown errors. It returns `"Internal Server Error"`, and the details go to the log with the same request id.

### Sample ADR (abridged)

```markdown
### ADR 0001: Server-side sessions instead of JWT access tokens

Status: Accepted (2026-11-03)

Context: First-party web client only; requirement to revoke access within 1 minute
on membership removal; single region; Redis already required for rate limiting.

Decision: Opaque session id in a __Host-sid cookie, hashed in Redis with
30 min idle / 12 h absolute expiry; rotate on login, MFA and tenant switch.

Alternatives: 15-min JWT + refresh rotation (revocation needs denylist anyway);
long-lived JWT (fails revocation requirement).

Consequences: Redis on the hot path (HA needed); CSRF protection required
(SameSite=Lax + Origin check); partners will need separate API tokens later.
```

### PR sequence that worked well

1. Skeleton, lint, typecheck, Vitest and the CI workflow (enable branch protection right after merging).
2. Schema, migrations, repositories, and docker compose Postgres in CI.
3. Users, argon2id, sessions, login with rate limit.
4. TOTP enrollment and verification.
5. Invoices CRUD with the policy and the cross-tenant suite.
6. Idempotency and cursor pagination.
7. Hardening: helmet, CSRF, log redaction, config validation, dependency and secret scanning.

## Common mistakes

- **Authorization in route handlers.** It works until a second entry point (an import job, a GraphQL resolver) skips it.
- **`app.set("trust proxy", true)`.** Clients can then spoof `X-Forwarded-For` and get a fresh rate-limit bucket on every request.
- **In-memory rate limit store.** It resets on deploy and splits across instances, so the real limit becomes N times the configured one.
- **Security controls configured but not tested.** Headers disappear in a refactor and nobody notices.
- **PRs as a formality.** One giant "initial commit" followed by four tiny PRs to tick the box. Reviewers, and interviewers looking at your GitHub, can tell.
- **ADRs that only state the choice.** Without alternatives and consequences, an ADR does not help the next engineer decide whether to revisit it.
- **Logging `req.body` on errors.** That writes passwords and TOTP codes to your log provider.

## Trade-offs worth discussing

- **Sessions vs JWT for this API.** Sessions make revocation trivial but put Redis on the hot path. JWTs suit partner and server-to-server clients. Many products run both: cookies for the web app, scoped API tokens for integrations.
- **RLS cost.** RLS adds a little planning overhead and makes debugging harder (an "empty result" when the tenant is not set), in exchange for fail-closed isolation.
- **Rate-limit keys.** Per IP penalizes offices behind NAT, and per account enables lockout attacks on a victim. Combining both, with progressive delays, balances the two.
- **Strict unknown-key rejection.** It catches mass assignment and client typos, but makes forward-compatible clients that send newer fields fail. Usually acceptable for requests, never for responses.
- **How much process for a solo project.** Branch protection and PRs feel heavy alone, but they are the evidence that you can work on a team, and they force you to write down your reasoning.

## Grade yourself

| Dimension | Strong | Acceptable | Needs work |
|---|---|---|---|
| Authentication | argon2id, sessions or short JWTs with rotation, MFA, revocation tested | Secure hashing and sessions, MFA missing | Long-lived tokens in localStorage, weak hashing |
| Authorization and isolation | Policy in use cases, role-by-action matrix test, contract-generated cross-tenant suite, RLS | Scoped repos and some role tests | Checks in handlers, no cross-tenant tests |
| Hardening | Validation, problem details, Redis-backed limits, headers, redaction, all asserted by tests | Most controls present, partly tested | Controls missing or only configured |
| Contract fidelity | Responses validated against the YAML, Spectral in CI | Contract exists and is mostly accurate | Implementation and contract diverge |
| Workflow | 6+ focused PRs with full descriptions, review comments addressed, protection includes admins, 3+ ADRs with alternatives | 5 PRs, short descriptions, ADRs present | Direct pushes to main, no ADRs |
| Operability | README to green tests in under 15 minutes, diagram, env validated at startup | Runs with some manual steps | Undocumented setup |

## Going further

- Add an OIDC login against Keycloak with per-tenant IdP configuration, reusing your design from the tenant-isolation problem.
- Deploy to a preview environment and run an OWASP ZAP baseline scan in CI.
- Add an audit log of who finalized or voided which invoice, written in the same transaction, and expose it through the API.
