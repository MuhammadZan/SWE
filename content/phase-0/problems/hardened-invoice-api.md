## Scenario

This capstone brings the phase together. You will ship an invoices API that you would be comfortable exposing to paying enterprise customers and defending in a security review. You will also build it the way a professional team does: through small pull requests with descriptions, CI gates, branch protection and written decisions.

The product is the same multi-tenant invoicing service from the earlier exercises. Accountants create, list, finalize and void invoices for their company. Viewers can only read. Owners manage users. The API will be consumed by your own frontend and by partners, so the contract from `api-contract-design` is the spec, and any change to it must be deliberate.

## Starting point

- Your `openapi.yaml` from **Invoices API: Contract First**. Extend it with `POST /v1/invoices/{id}/finalize`, `POST /v1/invoices/{id}/void`, and the auth endpoints you need (`/v1/auth/login`, `/v1/auth/logout`, and MFA enrollment and verification).
- The lessons on authentication, application security and git workflow.
- Your findings from **Security Audit**. Every vulnerability class you found there should be impossible by construction here.

Start from an empty repository. The first PR you merge should contain only the project skeleton, linting, a trivial test and the CI workflow. Then enable branch protection on `main`, so every later change goes through a PR.

## What to build

### Functionality

- Invoice lifecycle: `draft -> open (finalize) -> paid | void`. Finalized invoices are immutable except for status transitions. Voiding a paid invoice is rejected with a 409 problem.
- Creation with `Idempotency-Key`, listing with cursor pagination and filters, and get by id, all behaving exactly as your contract says.

### Authentication

- Choose server-side sessions in `__Host-` cookies (HttpOnly, Secure, SameSite=Lax) **or** short-lived access JWTs (15 minutes or less) with rotating refresh tokens. Record the decision in an ADR.
- Hash passwords with argon2id at the OWASP baseline parameters or stronger.
- MFA with TOTP (for example `otplib`), required for the owner role, or OIDC login against Keycloak running in docker compose.
- Session revocation on logout, on password change and on membership removal.
- If you use cookies, CSRF protection: SameSite plus an Origin check, or a token.

### Authorization

- A `memberships(user_id, tenant_id, role)` table with roles `owner`, `accountant` and `viewer`.
- A policy function called from use cases, for example `can(principal, "invoice.finalize", invoice)`. Route handlers never decide permissions on their own.
- Every repository method requires `tenantId`. RLS is a stretch goal and is strongly recommended.

### Hardening

- Strict zod (or similar) schemas for every body, query and path parameter. Unknown keys are rejected.
- RFC 9457 problem details for every error, with `instance` set to a correlation id that also appears in the logs.
- Rate limits: login at 5 per 15 minutes per account plus IP, writes at 60 per minute per tenant, both backed by Redis (or Postgres) so they hold across multiple instances. Responses include `Retry-After` and `RateLimit` headers.
- Security headers with helmet or equivalent: CSP `default-src 'none'; frame-ancestors 'none'` for a JSON API, HSTS, `nosniff`, and `Referrer-Policy`.
- Structured logging (pino) with redaction of `authorization`, `cookie`, `password`, `totp` and email fields.
- Configuration validated with zod at startup. `.env.example` is committed, and real secrets never are.
- Correct `trust proxy` configuration if you deploy behind a proxy, so rate limiting uses real client IPs.

### Workflow

- At least 5 merged PRs, each with a description covering why, what changed, risk, how to test, and screenshots or curl output where useful. A suggested sequence: skeleton and CI, schema and repositories, auth, invoices with authorization, idempotency and pagination, hardening.
- Branch protection (or a ruleset) on `main`: require a PR, require the CI checks, block force pushes, and apply the rules to admins.
- Review: if you work alone, use a second account, a friend, or an AI reviewer. Record in each PR which one you used, and respond to every comment.
- At least 3 ADRs in `docs/adr/` using a consistent template (context, decision, alternatives, consequences).

## Constraints

- Node 20+, TypeScript strict mode, Postgres 16+.
- No auth-as-a-service SDK doing the core work (Auth0, Clerk, Supabase Auth). You may use libraries such as `argon2`, `jose`, `otplib`, `helmet` and `express-rate-limit`.
- Tests run in CI against a real Postgres service container.
- No secrets in git history. Run gitleaks or GitHub secret scanning to prove it.

## How to measure and verify

- **Contract:** response validation against `openapi.yaml` passes in tests for every operation, and Spectral lint passes in CI.
- **Authorization matrix:** a table-driven test covers every role and action combination (3 roles by at least 6 actions), with the expected allow or deny.
- **Tenant isolation:** a test iterates over every invoice route with tenant B's session and tenant A's ids, and expects 404 every time.
- **Security controls:** tests assert headers, a 429 after the limit, a 400 with an unknown body key, no `stack` in any 500 response, and redacted fields in captured logs.
- **Coverage:** 80% or higher on the domain and application layers, reported in CI.
- **Process:** the PR list on GitHub shows 5 or more merged PRs with descriptions and green checks. The branch protection settings are screenshotted or exported into the README.
- **Smoke run:** `docker compose up`, then the README's curl walkthrough (sign up, log in, create an invoice twice with the same key, list it, finalize it), works on a clean machine in under 15 minutes.
