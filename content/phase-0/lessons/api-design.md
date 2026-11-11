## Why this matters

An API is a promise you cannot easily take back. Once a mobile app, a customer's integration or a partner's ERP depends on `GET /invoices` returning `amount` as a string, renaming it to `totalCents` breaks someone's month-end close. Once a client retries a timed-out `POST /payments` and charges a customer twice, you are writing apology emails and refunds.

Most API pain in SaaS products is not about frameworks. It comes from inconsistent naming, ad hoc error shapes, pagination that skips rows, unsafe retries, and breaking changes shipped without noticing. This lesson gives you a small set of conventions that prevent all of these, and the vocabulary to defend them in design reviews.

## Resource modeling

Start from the nouns in the domain, not from your database tables or your UI screens. For an invoicing module: tenants, customers, invoices, invoice lines, payments, credit notes. Then decide which are top-level resources and which are sub-resources.

```
GET    /v1/invoices                    list (filtered, paginated)
POST   /v1/invoices                    create a draft invoice
GET    /v1/invoices/{id}               read one
PATCH  /v1/invoices/{id}               partial update (only while draft)
DELETE /v1/invoices/{id}               delete a draft
GET    /v1/invoices/{id}/lines         sub-resource collection
POST   /v1/invoices/{id}/finalize      state transition (action)
POST   /v1/invoices/{id}/payments      record a payment
```

Conventions worth standardizing:

- Plural nouns, kebab-case paths, consistent casing in JSON (pick camelCase or snake_case once, for every endpoint).
- IDs are opaque strings (UUIDs or prefixed IDs like `inv_01J...`), never sequential integers that reveal volume and invite enumeration.
- Money as integer minor units plus a currency (`{ "amountCents": 125000, "currency": "EUR" }`), never floats.
- Timestamps in ISO 8601 UTC (`2026-03-01T09:30:00Z`).
- The tenant comes from the authenticated principal, not from a path parameter the client can change. If you put it in the path for readability, the server must still check it matches the token.

### Actions that are not CRUD

Finalizing, voiding or sending an invoice are state transitions with business rules. Modeling them as `PATCH { "status": "finalized" }` hides the rules and lets clients attempt arbitrary transitions. An explicit action endpoint (`POST /invoices/{id}/finalize`) is clearer, maps to one use case, and can have its own permissions.

## REST vs RPC

| | REST-style | RPC-style (gRPC, tRPC, JSON-RPC) |
|---|---|---|
| Model | Resources + HTTP methods | Procedures (`createInvoice`, `finalizeInvoice`) |
| HTTP semantics | Uses methods, status codes, caching | Often POST everything, errors in body |
| Best for | Public APIs, third-party integrations, cacheable reads | Internal service-to-service, monorepo full-stack (tRPC), high-throughput (gRPC) |
| Contract | OpenAPI | Protobuf, TypeScript types |

Neither is "correct." Public APIs that customers integrate with benefit from REST conventions because every HTTP tool understands them. Internal calls between your own services or between your Next.js frontend and backend often fit RPC better. What matters is being consistent within one API.

HTTP methods carry guarantees that intermediaries and clients rely on:

| Method | Safe (no side effects) | Idempotent (repeat = same effect) |
|---|---|---|
| GET, HEAD | Yes | Yes |
| PUT | No | Yes |
| DELETE | No | Yes |
| PATCH | No | Not guaranteed |
| POST | No | No |

## Status codes

Use a small, predictable set:

| Code | When |
|---|---|
| 200 OK | Successful read or update with body |
| 201 Created | Resource created; include `Location` header |
| 202 Accepted | Work queued (PDF export, bulk import) |
| 204 No Content | Successful delete, no body |
| 400 Bad Request | Malformed JSON or syntax |
| 401 Unauthorized | Missing or invalid credentials (really "unauthenticated") |
| 403 Forbidden | Authenticated but not allowed |
| 404 Not Found | Does not exist, or exists in another tenant (do not reveal which) |
| 409 Conflict | State conflict: finalizing an already-voided invoice, idempotency key reused with a different body |
| 412 Precondition Failed | `If-Match` ETag mismatch (optimistic concurrency) |
| 422 Unprocessable Content | Well-formed but fails validation |
| 429 Too Many Requests | Rate limited; include `Retry-After` |
| 500 / 503 | Server bug / temporarily unavailable |

The 400 vs 422 split is a team convention; pick one rule and document it.

## A consistent error format: RFC 9457 problem details

```json
// Bad: three endpoints, three error shapes
{ "error": "invalid" }
{ "message": "Customer not found", "code": 404 }
{ "errors": ["dueDate must be after issueDate"] }
```

RFC 9457 (which obsoletes RFC 7807) defines `application/problem+json` with standard members: `type` (a URI identifying the problem type), `title` (short, human-readable summary of the type), `status` (the HTTP status code), `detail` (explanation specific to this occurrence) and `instance` (a URI for this occurrence). You may add extension members.

```json
HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json

{
  "type": "https://api.acme-erp.com/problems/validation-error",
  "title": "Your request is not valid.",
  "status": 422,
  "detail": "2 fields failed validation.",
  "instance": "/v1/invoices",
  "errors": [
    { "pointer": "/dueDate", "detail": "must be on or after issueDate" },
    { "pointer": "/lines/0/quantity", "detail": "must be greater than 0" }
  ],
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736"
}
```

Implement it once, centrally:

```ts
export class ProblemError extends Error {
  constructor(
    public status: number,
    public type: string,
    public title: string,
    public detail?: string,
    public extensions: Record<string, unknown> = {},
  ) {
    super(detail ?? title);
  }
}

export function problemHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const p =
    err instanceof ProblemError
      ? err
      : new ProblemError(500, "about:blank", "Internal Server Error"); // never leak stack traces
  res
    .status(p.status)
    .type("application/problem+json")
    .json({
      type: p.type,
      title: p.title,
      status: p.status,
      detail: p.detail,
      instance: req.originalUrl,
      ...p.extensions,
    });
}
```

Clients switch on `type` (stable), not on `title` or `detail` (human text that may change or be translated).

## Pagination: offset vs cursor

```sql
-- Offset: simple, supports "jump to page 40"
SELECT * FROM invoices
WHERE tenant_id = $1
ORDER BY created_at DESC
LIMIT 50 OFFSET 2000;
```

Offset has two problems. The database still reads and discards 2,000 rows, so deep pages get slower. And if a new invoice is inserted while a user pages, every row shifts by one: they see a duplicate, or a deleted row makes them skip one. For an export job that walks all invoices, that means missing data.

Cursor (keyset) pagination remembers the position of the last row and continues after it:

```sql
-- Cursor: stable and fast with an index on (tenant_id, created_at DESC, id DESC)
SELECT * FROM invoices
WHERE tenant_id = $1
  AND (created_at, id) < ($2, $3)   -- values from the last row of the previous page
ORDER BY created_at DESC, id DESC
LIMIT 51;                           -- fetch one extra to know if there is a next page
```

The `id` tiebreaker is essential: many invoices can share a `created_at`, and without a unique final sort key rows get skipped or repeated. Encode the cursor as opaque base64 so clients do not build it themselves:

```ts
const encodeCursor = (row: { createdAt: Date; id: string }) =>
  Buffer.from(JSON.stringify([row.createdAt.toISOString(), row.id])).toString("base64url");

// Response
{
  "data": [ /* 50 invoices */ ],
  "nextCursor": "WyIyMDI2LTAzLTAxVDA5OjMwOjAwWiIsImludl8wMUouLi4iXQ",
  "hasMore": true
}
```

| | Offset | Cursor |
|---|---|---|
| Jump to arbitrary page | Yes | No |
| Stable under inserts/deletes | No | Yes |
| Deep page performance | Degrades, `O(offset)` | Constant with the right index |
| Total count | Easy but costly | Usually omitted |

Use offset for small admin tables where page numbers matter; use cursor for APIs, feeds, sync and exports. Always cap `limit` (for example 1–100, default 25).

## Filtering and sorting

```
GET /v1/invoices?status=open,overdue&customerId=cus_123&dueBefore=2026-04-01&sort=-dueDate&limit=50
```

Whitelist filter and sort fields, validate them with a schema, and map them to parameterized SQL. Never interpolate a `sort` parameter into SQL directly.

```ts
const ListInvoicesQuery = z.object({
  status: z.string().optional()
    .transform((s) => s?.split(","))
    .pipe(z.array(z.enum(["draft", "open", "paid", "void", "overdue"])).optional()),
  customerId: z.string().optional(),
  dueBefore: z.coerce.date().optional(),
  sort: z.enum(["dueDate", "-dueDate", "createdAt", "-createdAt"]).default("-createdAt"),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});
```

## Idempotency keys for POST

A client calls `POST /v1/payments`. The network drops the response. Did the payment go through? The client cannot know, and retrying a POST may charge twice. The fix, popularized by Stripe and described in the IETF draft "The Idempotency-Key HTTP Header Field", is for the client to send a unique key per logical operation:

```
POST /v1/invoices
Idempotency-Key: 8e03978e-40d5-43e8-bc93-6894a57f9324
```

Server behavior:

1. First request with a key: process it, store the key with the request fingerprint (hash of method, path and body) and the response, scoped to the tenant.
2. Same key, same fingerprint, completed: return the stored response without re-executing.
3. Same key, different body: return `422` or `409`; the client is misusing the key.
4. Same key while the first is still in progress: return `409` so the client retries later.
5. Expire keys after a window (24 hours is common).

```sql
CREATE TABLE idempotency_keys (
  tenant_id   uuid        NOT NULL,
  key         text        NOT NULL,
  fingerprint text        NOT NULL,
  status      text        NOT NULL CHECK (status IN ('in_progress', 'completed')),
  response_status int,
  response_body   jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);
```

```ts
// Claim the key atomically: the primary key makes concurrent duplicates lose.
const claimed = await tx.query(
  `INSERT INTO idempotency_keys (tenant_id, key, fingerprint, status)
   VALUES ($1, $2, $3, 'in_progress')
   ON CONFLICT (tenant_id, key) DO NOTHING
   RETURNING key`,
  [tenantId, key, fingerprint],
);
if (claimed.rowCount === 0) {
  const existing = await loadKey(tenantId, key);
  if (existing.fingerprint !== fingerprint) throw conflict("idempotency-key-reused");
  if (existing.status === "in_progress") throw conflict("request-in-progress");
  return replay(existing); // same status code and body as the first time
}
```

Ideally, store the final response in the same database transaction that creates the invoice, so the two cannot diverge.

## Contracts with OpenAPI

An OpenAPI 3.1 document is the machine-readable contract: paths, parameters, request and response schemas (3.1 uses full JSON Schema), auth schemes and error responses.

```yaml
openapi: 3.1.0
info: { title: Invoices API, version: 1.4.0 }
paths:
  /v1/invoices:
    post:
      operationId: createInvoice
      parameters:
        - in: header
          name: Idempotency-Key
          required: true
          schema: { type: string, maxLength: 255 }
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/CreateInvoice" }
      responses:
        "201":
          description: Created
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Invoice" }
        "422":
          description: Validation failed
          content:
            application/problem+json:
              schema: { $ref: "#/components/schemas/Problem" }
```

Contract-first (write the spec, review it, generate types and docs) catches design mistakes before code exists. Code-first (generate the spec from zod schemas or decorators) keeps spec and code in sync. Either way, validate in CI: lint the spec (Spectral or Redocly), and run a breaking-change diff (oasdiff) against the previous version on every PR.

## Versioning and backward compatibility

| Change | Compatible? |
|---|---|
| Add an optional request field | Yes |
| Add a response field | Yes, if clients ignore unknown fields (tell them to) |
| Add a new endpoint | Yes |
| Add a new enum value in a response | Risky: strict clients may crash; document that enums can grow |
| Make an optional field required | No |
| Rename or remove a field | No |
| Change a type (`string` to `number`) | No |
| Change default sort or pagination semantics | No |

Strategies: URL versioning (`/v1/`) is explicit and easy to route; header or date-based versioning (Stripe's `Stripe-Version: 2024-06-20`) lets you evolve continuously. Most teams do fine with `/v1` plus a strict rule: within a major version, only additive changes. When you must break, run v1 and v2 side by side, announce a sunset date, and send `Deprecation` and `Sunset` headers.

## Webhooks basics

Webhooks are your API calling theirs: `invoice.paid`, `invoice.overdue`. Design them like an API too:

- Payload includes an event `id`, `type`, `createdAt`, and either the full object or its ID. Receivers must deduplicate on event `id` because delivery is at-least-once.
- Sign the payload: HMAC-SHA256 over `timestamp + "." + rawBody` with a per-endpoint secret, sent in a header. Receivers verify with a constant-time comparison and reject old timestamps (for example over 5 minutes) to stop replays.
- Retry with exponential backoff for hours or days, and give customers a way to see and replay failed deliveries.
- Do not assume ordering; include enough state for the receiver to reconcile.

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyWebhook(rawBody: string, header: string, secret: string) {
  const [t, sig] = header.split(",").map((p) => p.split("=")[1]);
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(sig ?? "", "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
```

## Common mistakes

- Returning `200 { "success": false }` so monitoring, retries and clients cannot tell anything failed.
- Every endpoint inventing its own error shape.
- Offset pagination for exports and sync, silently skipping rows when data changes.
- Sorting on a non-unique column without an `id` tiebreaker.
- Retrying POSTs without idempotency keys, or storing keys globally instead of per tenant.
- Exposing database columns directly, so a migration becomes a breaking API change.
- Taking `tenantId` from the request body and trusting it.
- Shipping a field rename as a "small fix" inside `/v1`.

## In the real world

Stripe, GitHub and Shopify are worth studying: consistent resource naming, cursor pagination, idempotency keys, signed webhooks and long-lived versions. In a SaaS company the API contract usually lives in the repo as `openapi.yaml`, with CI checks for lint and breaking changes, generated TypeScript clients for the frontend, and published docs for customers.

In interviews, API design questions ("design the API for an invoicing service") are graded on resource modeling, correct status codes, pagination choice with reasoning, idempotency for money-moving operations, error format, and how you would evolve it without breaking clients.

## Try it

Pick one list endpoint in your current app. Rewrite it to cursor pagination with a `(created_at, id)` keyset and a matching composite index. Write a test that inserts rows between page requests and asserts no row is skipped or duplicated. Then add a problem-details error handler and convert two existing error responses to it.
