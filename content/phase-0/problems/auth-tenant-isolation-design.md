## Scenario

You are the founding engineer on the platform team of a growing multi-tenant ERP. It covers invoicing, inventory, purchasing and a general ledger. There are 1,200 tenants today. Most are small businesses that log in with email and password. Forty are enterprises with 200 to 5,000 employees each, and their procurement teams now send security questionnaires with questions like these:

- "Do you support SSO with our Entra ID or Okta, and do accounts deprovision automatically when we offboard an employee?"
- "How do you guarantee our data cannot be read by another customer?"
- "Can your support staff access our data, and is that logged?"
- "Can we define our own roles, for example 'AP clerk who can enter but not approve bills over 5,000 EUR'?"

The current system is a single Node monolith with a `users` table that has a global `role` column and a `tenant_id`. It uses JWTs that last 30 days and are stored in localStorage. The team is about to split out a reporting service and a background worker that generates PDFs and sends emails. Last month a code review caught a reporting query with no `tenant_id` filter, and nobody is sure there aren't others.

Design the authentication, authorization and tenant-isolation architecture that answers these questionnaires honestly and survives the next three years of growth. This is a design problem. You produce a diagram and a `DESIGN.md`, not a running system.

## Starting point

Assumptions you can rely on (state any others you make):

- Peak 3,000 requests per second across all tenants. The largest tenant generates 15% of traffic.
- Postgres 16 is the main database (shared schema, `tenant_id` column on every tenant-owned table). Redis is available.
- Services: `web-api` (monolith), `reporting` (new, read-heavy, uses a read replica), and `worker` (queue consumer for PDFs, emails and imports).
- Users can belong to several tenants. This is common for accountants who serve multiple clients.
- Enterprise IdPs speak OIDC. Some also speak SAML, which is optional for you.

## What to build

### 1. Threat model

List at least five concrete threats with their likely source and impact, for example:

- a cross-tenant read through an id in a URL
- a stolen session cookie
- a compromised or misconfigured IdP belonging to one tenant
- a support engineer browsing customer data
- a leaked service credential
- an employee who keeps access after offboarding

For each threat, name the control in your design that addresses it.

### 2. Authentication

- Local login: the password hashing algorithm and parameters, MFA (which factors, and whether tenants can enforce it), lockout or rate limiting, and the password reset flow.
- Enterprise SSO: OIDC authorization code flow with PKCE. Explain how a login is routed to the right tenant's IdP (email domain discovery, tenant subdomain, or both), how users are linked (`iss`, `sub`), and just-in-time provisioning. Also cover deprovisioning: SCIM, IdP-driven session checks, or periodic re-authentication.
- Sessions: the mechanism (server-side session vs token), cookie attributes, idle and absolute lifetimes, tenant switching, and revocation. Give numbers.

### 3. Authorization

- A permission catalog (for example `invoice.read`, `invoice.create`, `invoice.approve`, `ledger.post`, `users.manage`).
- At least four built-in roles per tenant, plus custom roles that tenant admins can define.
- A data model: `users`, `tenants`, `memberships`, `roles`, `role_permissions`, `identity_links`, and tenant IdP configuration.
- Where checks happen in the layered architecture, and how you handle conditions RBAC cannot express (approval limits, "own records only").

### 4. Tenant isolation, defense in depth

At least three independent layers, for example:

1. Tenant id comes only from the server-side session.
2. A repository layer that requires tenant id in every method.
3. Postgres row-level security with a per-transaction tenant setting.

You might also add per-tenant rate limits or separate databases for the largest tenants. For each layer, explain what still protects data if that layer has a bug.

### 5. Service-to-service and workers

Explain how `reporting` and `worker` authenticate to each other and to the database: short-lived signed tokens with per-service audiences, mTLS, or a workload identity from your cloud. Describe how tenant context travels inside queue messages and how the consumer re-verifies it.

### 6. Support access

Design impersonation or "break-glass" access with tenant consent or approval, a time limit, a visible banner, and an immutable audit log.

## Constraints

- You cannot trust any tenant id sent by a client.
- Revoking a user's access in your app must take effect within 1 minute. Enterprise IdP deprovisioning must take effect within 15 minutes.
- No shared, long-lived credentials between services.
- The design must work with connection pooling (PgBouncer in transaction mode).

## How to measure and verify

- Walk each threat in your threat model through the diagram and point to the control that stops it.
- For each isolation layer, write the specific bug that would bypass it, and show which other layer catches that bug.
- Put a revocation table in `DESIGN.md` with one row per event (user removed from tenant, password reset, IdP disabled the user, role downgraded) and a column for time to effect.
- Do a rough capacity check: if every request performs a session lookup in Redis and a permission check, what does that cost per second at peak, and do you need caching? State how cache invalidation works when roles change.
