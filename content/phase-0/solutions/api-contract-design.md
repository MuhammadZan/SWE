## What a strong solution looks like

A strong submission reads like an API a partner could integrate with on day one. The `openapi.yaml` was clearly written first: schemas are reusable components, every operation lists all of its error responses with the same `Problem` schema, and the description states a compatibility policy, for example "within /v1 we only add optional fields, endpoints and enum values; clients must ignore unknown fields". There are examples for every operation.

The implementation is boring in the best sense. Idempotency is enforced by a database constraint, not by an in-memory map or a "check then insert" race. Pagination is keyset-based, with a unique tiebreaker and an index that matches the `ORDER BY` exactly. Tenant id comes only from the request context.

Most importantly, the tests prove the guarantees. The concurrency test really fires requests in parallel, and the pagination test inserts rows while paging. The author has checked that both tests fail when the protection is removed.

## Reference approach

### Contract excerpt

```yaml
paths:
  /v1/invoices:
    post:
      operationId: createInvoice
      parameters:
        - name: Idempotency-Key
          in: header
          required: true
          schema: { type: string, minLength: 8, maxLength: 255 }
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/InvoiceCreate" }
      responses:
        "201":
          description: Created (or replayed)
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Invoice" }
        "400": { $ref: "#/components/responses/Problem" }
        "409": { $ref: "#/components/responses/Problem" }
        "422": { $ref: "#/components/responses/Problem" }
components:
  schemas:
    Problem:
      type: object
      required: [type, title, status]
      properties:
        type: { type: string, format: uri-reference }
        title: { type: string }
        status: { type: integer }
        detail: { type: string }
        instance: { type: string }
        errors:
          type: array
          items:
            type: object
            required: [field, message]
            properties:
              field: { type: string }
              message: { type: string }
  responses:
    Problem:
      description: Error
      content:
        application/problem+json:
          schema: { $ref: "#/components/schemas/Problem" }
```

In OpenAPI 3.1, nullable is written as `type: [string, "null"]`, not `nullable: true`. Use that for `nextCursor`.

### Idempotency table and flow

```sql
CREATE TABLE idempotency_keys (
  tenant_id     uuid  NOT NULL,
  key           text  NOT NULL,
  request_hash  text  NOT NULL,
  status        text  NOT NULL CHECK (status IN ('in_progress','completed')),
  response_code int,
  response_body jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);
```

```ts
export async function createInvoiceIdempotent(
  db: Pool, tenantId: string, key: string, input: InvoiceCreate,
): Promise<{ status: number; body: unknown }> {
  const hash = sha256(canonicalJson(input));
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const claim = await client.query(
      `INSERT INTO idempotency_keys (tenant_id, key, request_hash, status)
       VALUES ($1, $2, $3, 'in_progress')
       ON CONFLICT (tenant_id, key) DO NOTHING
       RETURNING key`,
      [tenantId, key, hash],
    );
    if (claim.rowCount === 0) {
      await client.query("ROLLBACK");
      const { rows: [row] } = await db.query(
        "SELECT * FROM idempotency_keys WHERE tenant_id = $1 AND key = $2",
        [tenantId, key],
      );
      if (row.request_hash !== hash) throw new KeyReusedError();   // 422
      if (row.status === "in_progress") throw new KeyInProgressError(); // 409
      return { status: row.response_code, body: row.response_body };
    }
    const invoice = await insertInvoice(client, tenantId, input);
    const body = toInvoiceDto(invoice);
    await client.query(
      `UPDATE idempotency_keys SET status = 'completed', response_code = 201,
       response_body = $3 WHERE tenant_id = $1 AND key = $2`,
      [tenantId, key, body],
    );
    await client.query("COMMIT");
    return { status: 201, body };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
```

Because the claim and the invoice are in one transaction, a concurrent second request blocks on the primary key until the first commits. It then sees the conflict, finds the row completed, and replays it. If the first transaction rolls back, the key disappears and a retry can succeed. That is the behavior you want after a crash. `canonicalJson` must sort keys, so that `{a,b}` and `{b,a}` hash the same.

### Keyset pagination

```sql
CREATE INDEX invoices_tenant_created_id
  ON invoices (tenant_id, created_at DESC, id DESC);
```

```ts
const rows = await db.query(
  `SELECT * FROM invoices
   WHERE tenant_id = $1
     AND ($2::timestamptz IS NULL OR (created_at, id) < ($2, $3))
     AND ($4::text[] IS NULL OR status = ANY($4))
   ORDER BY created_at DESC, id DESC
   LIMIT $5`,
  [tenantId, cur?.t ?? null, cur?.id ?? null, statuses ?? null, limit + 1],
);
const page = rows.rows.slice(0, limit);
const nextCursor = rows.rows.length > limit
  ? encodeCursor(page[page.length - 1]) : null;
```

The row comparison `(created_at, id) < ($2, $3)` matches the index order, so Postgres can seek straight to the cursor position. A cursor should be bound to the filters it was created with. Either encode the filters in the cursor, or reject a cursor used with different filters. Watch timestamp precision too: Postgres stores microseconds but JavaScript `Date` keeps only milliseconds, so encode `created_at` as text from SQL (`to_char` or `created_at::text`) or you will skip rows that share a millisecond.

### The tests that matter

```ts
it("creates exactly one invoice for 10 concurrent retries", async () => {
  const key = "key-" + randomUUID();
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      request(app).post("/v1/invoices").set("X-Test-Tenant", A)
        .set("Idempotency-Key", key).send(body)),
  );
  const created = results.filter((r) => r.status === 201);
  expect(new Set(created.map((r) => r.body.id)).size).toBe(1);
  results.filter((r) => r.status !== 201)
    .forEach((r) => expect(r.status).toBe(409));
  expect(await countInvoices(A)).toBe(1);
});
```

## Common mistakes

- **Check-then-insert idempotency.** `SELECT` the key, and if it is missing, `INSERT`. Two concurrent requests both see nothing and both create an invoice. Only a unique constraint (or a lock) closes the race.
- **Storing the key in a separate transaction from the invoice.** If the process dies between the two writes, you either lose the key (duplicates) or keep a key with no invoice (permanent 409).
- **Ignoring the request body.** Replaying the old response for a different body hides client bugs that bill the wrong amount.
- **Cursor on `created_at` alone.** Rows with equal timestamps are skipped or repeated at page boundaries. Bulk imports produce exactly that.
- **Returning `total` count with every page.** `COUNT(*)` on a large tenant on every page request removes the performance advantage of keyset pagination. Make it optional or approximate.
- **Error shapes that drift.** The validation library's default output for 400s, problem details for 404s, and Express's HTML page for 500s. Clients then need three parsers.
- **A contract that is decoration.** If no test validates responses against `openapi.yaml`, the YAML and the code drift within weeks.

## Trade-offs worth discussing

- **Offset vs cursor.** Offset allows "jump to page 37" and is simpler for small admin tables. Cursor is correct under concurrent writes and fast at depth, but can only go next and previous. Many APIs offer cursors for sync and export, and offset for small UI tables.
- **Where to store idempotency records.** Postgres, in the same transaction, gives atomicity with the business write. Redis is faster, but cannot commit atomically with the invoice, so you need a reconciliation story.
- **409 vs waiting.** Returning 409 for an in-progress key is simple and honest. Blocking until the first request finishes is friendlier but holds connections. Stripe-style APIs return a conflict error.
- **URL versioning vs header versioning.** `/v1` is visible, cacheable and easy to route. Date-based header versions (Stripe's approach) allow finer-grained evolution but need version-transformation layers.
- **Contract-first vs code-first.** Contract-first forces design conversations early. Code-first (generating OpenAPI from zod or TypeBox) avoids duplication. Either is fine if CI checks that code and contract agree.

## Grade yourself

| Dimension | Strong | Acceptable | Needs work |
|---|---|---|---|
| Contract quality | Spectral clean, all errors use `Problem`, examples everywhere, compatibility policy written | Lints clean, most errors documented | YAML generated after the fact or missing error responses |
| Idempotency | Unique constraint in the same transaction, body fingerprint, concurrency test that fails without the constraint | Correct sequentially, concurrency untested | Check-then-insert or in-memory map |
| Pagination | Keyset with tiebreaker and matching index, test with duplicate timestamps and concurrent inserts | Keyset without a duplicate-timestamp test | Offset pagination or cursor on `created_at` only |
| Errors and validation | Every non-2xx is `application/problem+json` with field errors | Consistent JSON errors, not RFC 9457 | Mixed shapes, stack traces |
| Tenant isolation | Tenant only from context, 404 cross-tenant test for get and list | Scoped queries, no test | Tenant from query or body |
| Conformance testing | Responses validated against the YAML in the test suite | Manual check against the contract | No link between code and contract |

## Going further

- Add `oasdiff breaking` to CI against `main`'s version of the contract, so breaking changes need an explicit version bump.
- Implement `invoice.created` webhooks using the transactional outbox pattern, so an event is never sent for a rolled-back invoice.
- Read the IETF `Idempotency-Key` HTTP header draft and compare its recommendations with your implementation.
