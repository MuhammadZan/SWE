## What a strong solution looks like

A strong design starts from the threat model and makes every control traceable to a threat. It treats authentication (who are you), tenant resolution (acting for which company) and authorization (may you do this, to this record) as three separate steps, each with one owner.

It assumes that every layer will eventually have a bug. Tenant isolation therefore rests on several independent layers, and the document says honestly what each one catches. Revocation is given in minutes, not adjectives. Support access is a designed feature with consent and audit, not a superuser flag.

Finally, the writing argues trade-offs for this ERP: an accountant who belongs to 30 tenants, an enterprise whose IdP is the source of truth for employment, and a reporting service on a read replica.

## Reference approach

### Diagram in words

```
 Browser ──HTTPS──> Edge/LB ──> web-api ───────────────┐
    │                              │  1. session lookup (Redis)
    │  OIDC code+PKCE              │  2. membership + role (cache, 60s TTL,
    ▼                              │     evicted on change)
 Tenant IdP (Entra/Okta)           │  3. use case: can(principal, action, resource)
    │  ID token (iss, sub)         │  4. repo: tenantId required
    └────────> /auth/callback      │  5. BEGIN; set_config('app.tenant_id', $1, true)
                                   ▼
                 PgBouncer (txn mode) ──> Postgres (RLS FORCE, app role NOBYPASSRLS)
                                   ▲
 web-api ──job {tenantId, actorId, jobId}──> Queue ──> worker
            signed with service key           │ verifies signature + audience
                                              │ sets tenant per transaction
 web-api ──JWT(aud=reporting, 5 min, tenant, sub)──> reporting ──> read replica (RLS)
```

The trust boundaries are browser to edge, the IdP callback, service to service, and app to database. Authorization decisions are made in the use cases of `web-api` and `reporting`. The database enforces tenant scope through RLS but makes no role decisions.

### Authentication

- **Local:** argon2id (m=19 MiB, t=2, p=1 or stronger), breached-password check against k-anonymity hash prefixes, TOTP and WebAuthn as MFA factors, a tenant setting "require MFA", and login rate limits per account and per IP.
- **SSO:** a `tenant_idp_configs(tenant_id, issuer, client_id, client_secret_ref, verified_domains[])` table. The login page asks for an email. If the domain is a verified domain of an SSO tenant, the user is redirected to that IdP with PKCE, `state` and `nonce`. On callback, validate `iss` against **that tenant's configured issuer**, then `aud`, `exp` and `nonce`, and look up `identity_links(iss, sub) -> user_id`. JIT-provision a membership with the tenant's default role. Domain verification by DNS TXT record stops tenant X from claiming `@bigcorp.com`.
- **Deprovisioning:** SCIM 2.0 `PATCH active=false` removes the membership and deletes that user's sessions immediately. Without SCIM, SSO sessions have an 8-hour absolute lifetime and a 12-hour IdP re-authentication interval, which does not meet the 15-minute target. Enterprises that need 15 minutes must enable SCIM, and the doc says so plainly.
- **Sessions:** an opaque random 256-bit id in a `__Host-sid` cookie (HttpOnly, Secure, SameSite=Lax). Redis stores the SHA-256 hash of the id mapped to `{userId, activeTenantId, mfaAt, createdAt}`. Idle timeout is 30 minutes and absolute timeout is 12 hours. The session id is rotated on login, on MFA and on tenant switch.

Server-side sessions win over JWTs here because the requirement is revocation within 1 minute. With JWTs that would mean either 1-minute tokens or a denylist lookup on every request, which is a session store with extra steps.

### Authorization model

```sql
CREATE TABLE memberships (
  user_id   uuid REFERENCES users(id),
  tenant_id uuid REFERENCES tenants(id),
  role_id   uuid REFERENCES roles(id),
  status    text NOT NULL DEFAULT 'active',
  PRIMARY KEY (user_id, tenant_id)
);
CREATE TABLE roles (
  id        uuid PRIMARY KEY,
  tenant_id uuid NULL,         -- NULL = built-in (owner, admin, accountant, viewer)
  name      text NOT NULL
);
CREATE TABLE role_permissions (
  role_id    uuid REFERENCES roles(id),
  permission text NOT NULL,    -- 'invoice.approve', 'ledger.post', ...
  conditions jsonb,            -- e.g. {"maxAmountCents": 500000}
  PRIMARY KEY (role_id, permission)
);
```

RBAC with a small number of conditions covers the "AP clerk up to 5,000 EUR" case without a full ABAC engine. Policy evaluation is a pure function:

```ts
export function can(p: Principal, action: Permission, res?: { amountCents?: number; ownerId?: string }) {
  const grant = p.permissions.get(action);
  if (!grant) return false;
  if (grant.maxAmountCents != null && (res?.amountCents ?? 0) > grant.maxAmountCents) return false;
  if (grant.ownOnly && res?.ownerId !== p.userId) return false;
  return true;
}
```

The principal (user, active tenant, effective permissions) is built once per request. Permissions are cached in Redis per `(user, tenant)`, and the cache entry is deleted whenever a membership or role changes.

### Tenant isolation layers

| Layer | Catches | Bypassed by |
|---|---|---|
| Tenant from session only | Client-supplied tenant ids | Code that reads `req.query.tenantId` |
| Repositories require `tenantId` | Forgotten filters in normal code paths | Raw SQL in reports and scripts |
| Postgres RLS (`FORCE`, non-owner role, `set_config(..., true)`) | Any unscoped query from app roles | Migrations and admin role, so keep that role separate and audited |
| Tests: cross-tenant 404 suite over every route | Regressions | Routes missing from the suite, so generate the suite from the route list |

RLS policy:

```sql
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invoices
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

The `true` passed as the third argument to `set_config` makes the setting transaction-local. That is safe with PgBouncer in transaction mode, whereas session-level `SET` is not. If the setting is missing, `current_setting(..., true)` returns NULL, and the policy matches no rows. Isolation fails closed.

### Services, workers and support

- Service tokens are signed with an asymmetric key (ES256), have a 5-minute TTL and an `aud` per target service, and carry `sub` (the end user), `tenant` and `act` (the calling service). Keys come from a secret manager or workload identity. There are no shared static API keys.
- Queue messages carry `{tenantId, actorUserId}` and an HMAC (or travel on a queue only `web-api` can write to). The worker re-checks that the membership is still active before acting on behalf of the user.
- Support access requires a ticket id and tenant-owner approval (or a documented emergency break-glass that pages security). It lasts at most 60 minutes, shows a banner, is read-only by default, and is recorded in an append-only audit table that tenants can export.

### Numbers

At 3,000 rps, a session lookup plus a permission lookup is about 6,000 Redis GETs per second, well within one Redis node's capacity of roughly 100k operations per second. A 60-second in-process permission cache with explicit eviction would also work, but it pushes revocation toward the 1-minute limit, so measure it before adding it.

## Common mistakes

- **A global `role` column.** It breaks as soon as a user belongs to two tenants, which is the normal case for accountants.
- **Matching SSO users by email.** A misconfigured or malicious IdP can assert anyone's email. Link by `(iss, sub)` and verify domains.
- **Accepting any configured issuer for any tenant.** Tenant A's IdP must not be able to log users into tenant B.
- **RLS that is not actually enforced.** The app connects as the table owner or a superuser, or uses session-level `SET` behind a transaction-mode pooler.
- **Service-to-service calls that forward the user's browser token.** Every service can then replay it against every other service. Use audience-restricted tokens.
- **Support access as `is_superadmin`.** Without an audit trail, it fails every enterprise questionnaire.

## Trade-offs worth discussing

- **Shared schema with RLS vs schema-per-tenant vs database-per-tenant.** Shared schema is cheapest and simplest to migrate. A dedicated database for the largest tenants gives isolation and noisy-neighbor protection at a real operational cost. Many teams use a hybrid.
- **RBAC with conditions vs a policy engine (Cedar, OPA, OpenFGA).** An engine centralizes and audits policies, but adds latency and another system to run. At 4 roles and a few conditions, in-code policy is fine. Revisit when tenants need complex custom rules or relationship-based sharing.
- **Re-checking membership in workers.** It costs extra queries, but closes the gap where a removed user's queued export still runs.

## Grade yourself

| Dimension | Strong | Acceptable | Needs work |
|---|---|---|---|
| Threat model | 5+ concrete threats, each mapped to a named control | Threats listed, mapping partial | Generic list ("hackers") or missing |
| Authentication | Local + MFA + per-tenant OIDC with issuer binding, domain verification, SCIM, numeric lifetimes | SSO flow correct, deprovisioning vague | Email matching or long-lived JWTs without revocation |
| Authorization model | Per-tenant memberships, permission catalog, custom roles, conditions, decision point in use cases | RBAC per tenant, no conditions | Global roles or checks in controllers/UI |
| Tenant isolation | 3+ layers with RLS details correct for pooling, failure of each layer analyzed | 2 layers | Single `WHERE` clause convention |
| Services and support | Audience-scoped short-lived service tokens, tenant re-verified in workers, audited time-boxed impersonation | Service auth defined, support access thin | Shared API key, superadmin flag |
| Diagram | Trust boundaries and every decision point labeled | Components and flows clear | Boxes without decision points |

## Going further

- Prototype the policy in Cedar or OpenFGA and write tests for the "AP clerk up to 5,000 EUR" rule.
- Design a tenant migration path from the shared database to a dedicated one with zero downtime.
