## Scenario

Your company sells a multi-tenant invoicing and ERP product. Three consumers want to integrate with invoices: your own React frontend, a mobile app used by field sales on unreliable connections, and an accounting partner who will sync every invoice nightly into their ledger.

Today there is no public API, only ad hoc internal endpoints with inconsistent error shapes. Last quarter the mobile app created duplicate invoices when requests timed out and were retried, and an export job missed invoices because it used `?page=N` while new invoices were being created. The partner's lawyers want a written contract before they build anything.

Your job: design the **contract first**, as an OpenAPI 3.1 document, and then implement it in Node and TypeScript with tests that prove the two properties that went wrong in production: **idempotent creation** and **correct pagination**.

## Starting point

Use this minimal schema as your starting point. You may extend it.

```sql
CREATE TABLE tenants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL
);

CREATE TABLE invoices (
  id           text PRIMARY KEY,               -- e.g. inv_01HZX...
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  customer_id  text NOT NULL,
  status       text NOT NULL CHECK (status IN ('draft','open','paid','void')),
  currency     char(3) NOT NULL,
  total_cents  bigint NOT NULL CHECK (total_cents >= 0),
  due_date     date NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
```

Authentication is out of scope for this exercise. Simulate it with a test-only middleware that reads `X-Test-Tenant` and puts a `tenantId` on the request context. Every handler must take the tenant from that context, never from the body or query.

## What to build

### 1. The contract (`openapi.yaml`)

Write it before any implementation code. It must include:

- `servers` and a URL version prefix (`/v1`), plus a short `info.description` stating your compatibility policy (what counts as a breaking change).
- `POST /v1/invoices` with a required `Idempotency-Key` header (string, 8 to 255 chars), request schema `InvoiceCreate` (customerId, currency, lines or totalCents, dueDate), and responses 201, 400, 409 (same key still in progress), 422 (key reused with a different body), and 429.
- `GET /v1/invoices` with `limit` (1 to 100, default 20), `cursor` (opaque string), and filters `status` (one or more), `customerId`, `createdFrom`, `createdTo`. The response is `{ data: Invoice[], nextCursor: string | null }`.
- `GET /v1/invoices/{id}` returning 200 or 404.
- A `Problem` schema following RFC 9457 (`type`, `title`, `status`, `detail`, `instance`, plus an `errors` extension for field-level validation errors), used for every non-2xx response with media type `application/problem+json`.
- Examples for at least one success and one error per operation.

Lint it with Spectral (`@stoplight/spectral-cli` with the built-in `spectral:oas` ruleset). Zero errors is required. Warnings should be fixed or justified in the README.

### 2. The implementation

Any framework works (Express, Fastify, Hono). Use Postgres 16+ with `pg`, Kysely, Drizzle or Prisma.

- **Idempotency:** store keys per tenant along with a hash of the canonicalized request body, a status (`in_progress` or `completed`), and the response status code and body. The first request claims the key and creates the invoice in the same transaction. Later requests with the same key and body replay the stored response byte for byte. The same key with a different body gets a 422 problem. A request that arrives while the first is still running gets a 409 problem (or waits briefly, if you document it).
- **Pagination:** keyset over `(created_at DESC, id DESC)`, with an index that matches. The cursor is opaque to clients (base64url-encoded), and a malformed cursor returns a 400 problem.
- **Validation:** invalid query or body returns 400 with an `errors` array that names each offending field.

### 3. The tests

Use Vitest (or Jest) with supertest against a real Postgres instance (docker compose or Testcontainers).

- Idempotency: replaying a request, sending a mismatched body, and **10 concurrent requests** with the same key that produce exactly one row.
- Pagination: seed 250 invoices, with at least 20 of them sharing an identical `created_at`. Walk every page with `limit=37` while a background loop inserts new invoices. Assert that every seeded invoice appears exactly once and in order.
- Filters, limit bounds and malformed cursors.
- Tenant isolation: tenant B gets 404 for tenant A's invoice id and never sees it in a list.
- Contract conformance: validate real responses against `openapi.yaml`, for example with `openapi-response-validator`, `jest-openapi` or your own Ajv setup.

## Constraints

- Money is integer minor units (`total_cents`). No floats anywhere.
- Ids are opaque strings with a prefix (`inv_`), not sequential integers.
- No ORM-generated contract. The YAML is the source of truth, and the code conforms to it.
- `GET` endpoints must have no side effects.

## How to verify

1. `npx @stoplight/spectral-cli lint openapi.yaml` exits 0.
2. `npm test` runs all tests against a fresh database and passes.
3. Temporarily remove the unique constraint on the idempotency table. The concurrency test must fail. Restore it.
4. Temporarily drop `id` from the cursor and the `ORDER BY`. The pagination test must fail. Restore it.
5. Run `EXPLAIN ANALYZE` on a page-50 query with 100k seeded invoices and confirm it uses an index scan, not a sort over the whole tenant.

Steps 3 and 4 are the real proof. A test that still passes when the protection is removed is not testing the protection.
