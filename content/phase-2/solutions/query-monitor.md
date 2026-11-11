## What a strong solution looks like

A strong submission proves three things with evidence, not assertions: the naive route really runs 101 queries, each fix runs a constant number, and a test will fail the day someone reintroduces the pattern.

The repo has a per-request counter built on `AsyncLocalStorage` that both sets `X-Query-Count` and feeds the tests. The README shows a log excerpt with the 50 repeated `SELECT ... FROM customers WHERE id = $1` lines next to the single JOIN statement. A table compares the four routes (plus an optional `Promise.all` variant) with and without 5 ms of simulated latency, and the numbers match the model: naive is about 101 round trips times the latency, the fixes are about one to three round trips. The data in every route is identical, including the edge case of a customer with no billing address, and a test proves it.

## Reference approach

### The counter

Count at the lowest layer you control, from code that runs inside the request's async context.

```ts
import { AsyncLocalStorage } from "node:async_hooks";

export const reqCtx = new AsyncLocalStorage<{ queries: number }>();

// Raw pg: wrap pool.query once at startup
const rawQuery = pool.query.bind(pool);
pool.query = ((...args: Parameters<typeof rawQuery>) => {
  const c = reqCtx.getStore();
  if (c) c.queries++;
  return rawQuery(...args);
}) as typeof pool.query;

// Prisma: a client extension runs in the caller's context
export const db = prisma.$extends({
  query: {
    async $allOperations({ args, query }) {
      const c = reqCtx.getStore();
      if (c) c.queries++;
      return query(args);
    },
  },
});

app.use((req, res, next) => {
  const ctx = { queries: 0 };
  // Set the header before the body is written, not in res.on("finish")
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    res.setHeader("X-Query-Count", String(ctx.queries));
    if (ctx.queries > 10) console.warn(`${req.method} ${req.path}: ${ctx.queries} queries`);
    return originalJson(body);
  };
  reqCtx.run(ctx, next);
});
```

Two subtle points. Headers cannot be set in `res.on("finish")` because they have already been sent. And the Prisma extension counts *operations*: an `include` can execute two or three SQL statements for one operation. For the eager route, confirm the real statement count in the Postgres log and say in the README which number your header reports.

### The JOIN route

```sql
SELECT i.number,
       i.total_cents,                       -- pg returns bigint as a string: Number() it in Node
       c.name AS customer,
       a.id AS billing_id, a.line1, a.city, a.country, a.kind, a.customer_id AS billing_customer_id
FROM invoices i
JOIN customers c ON c.id = i.customer_id
LEFT JOIN addresses a ON a.customer_id = c.id AND a.kind = 'billing'
WHERE i.tenant_id = $1
ORDER BY i.issued_at DESC, i.id DESC
LIMIT 50;
```

The `kind = 'billing'` condition belongs in the `ON` clause. Put it in `WHERE` and the `LEFT JOIN` becomes an inner join, dropping invoices whose customer has no billing address. The partial unique index on billing addresses guarantees the join cannot duplicate invoice rows. Map the flat row back into the naive route's nested `billing` object (or `null`) in Node.

Add `id` as a tiebreaker to the sort in every route. Two invoices with the same `issued_at` can otherwise come back in different orders from different queries, and your deep-equality test will flake.

### The batched route

```ts
const invoices = await pool.query(LIST_SQL, [tenantId]);               // 1
const customerIds = [...new Set(invoices.rows.map((r) => r.customer_id))];
const [customers, addresses] = await Promise.all([
  pool.query("SELECT id, name FROM customers WHERE id = ANY($1::uuid[])", [customerIds]), // 2
  pool.query(
    "SELECT * FROM addresses WHERE customer_id = ANY($1::uuid[]) AND kind = 'billing'",
    [customerIds],
  ),                                                                    // 3
]);
const customerById = new Map(customers.rows.map((c) => [c.id, c]));
const billingByCustomer = new Map(addresses.rows.map((a) => [a.customer_id, a]));
```

Running the two follow-up queries concurrently is fine here: it is a fixed two, not N.

### The regression test

```ts
it.each(["/invoices/join", "/invoices/eager", "/invoices/batched"])("%s stays constant", async (route) => {
  const naive = await request(app).get("/invoices?tenant=t1");
  const fixed = await request(app).get(`${route}?tenant=t1`);
  expect(Number(naive.headers["x-query-count"])).toBe(101);
  expect(Number(fixed.headers["x-query-count"])).toBeLessThanOrEqual(3);
  expect(fixed.body).toEqual(naive.body);
});
```

Asserting 101 on the naive route matters: it proves the counter actually counts. A broken counter that always reports 0 would let every fixed-route assertion pass.

### Expected numbers

Locally, the naive route is about 15 to 40 ms and the fixes 2 to 5 ms. With 5 ms of added latency, the naive route lands around 520 to 600 ms and the JOIN route around 6 to 10 ms, comfortably more than the 10x the requirements ask for. The `Promise.all` variant drops to tens of milliseconds for a single request but degrades badly at 10 concurrent connections with a pool of 10, because each request tries to hold up to 50 connections at once.

## Common mistakes

- **Measuring only on localhost.** Without latency, N+1 costs a few milliseconds and looks harmless. The whole point is what happens across a network.
- **Filtering the left-joined table in `WHERE`**, silently dropping rows.
- **Comparing JSON with BigInt in it.** `res.json` throws on `BigInt`; raw `pg` returns `bigint` as a string. Normalize `total` to one type in every route, or the equality test fails for a reason unrelated to N+1.
- **Counting with Prisma's `$on("query")` event** and getting `undefined` from `getStore()`, then concluding the counter works because nothing crashed.
- **Calling `Promise.all` a fix.** It reduces latency and keeps the query count at N.
- **A regression test that only runs the fixed routes**, so a broken counter goes unnoticed.

## Trade-offs worth discussing

- **JOIN vs batched queries.** A JOIN is one round trip and ideal for many-to-one data like customer and billing address. For one-to-many data like line items, separate batched queries avoid duplicating the invoice columns on every line.
- **ORM eager loading.** Convenient and usually constant, but you do not control the SQL. Check the log after every ORM upgrade.
- **DataLoader.** The right tool for GraphQL resolvers, where the list and per-item code live in different places. Unnecessary for a REST handler you fully control.
- **Where to set the threshold.** A warning at 10 is a smell detector, not a rule. Some legitimate pages run 12 queries; the test pins specific routes to specific budgets.

## Grade yourself

| Dimension | Strong | Acceptable | Needs work |
| --- | --- | --- | --- |
| Evidence of N+1 | Log excerpt with 101 statements and the single JOIN statement, both in README | Counts stated, no log excerpt | "It was slow" with no count |
| Counter | ALS counter in the caller's context, header set before send, warning over 10 | Works for raw `pg` only | Global counter shared across requests |
| Fixes | Three routes with 1, at most 3, and 3 queries; identical JSON incl. missing billing address | Two routes fixed, or JSON differs slightly | `Promise.all` presented as the fix |
| Tests | Automated test asserts naive = 101, fixed at most 3, deep equality, against real Postgres | Query-count test only | No automated test |
| Measurement | 200 requests at `-c 10`, p50 and p95, with and without 5 ms latency | Local numbers only | Single request timing |
| Indexes | `(tenant_id, issued_at DESC)` shown in an EXPLAIN excerpt; billing address uniqueness enforced | Index created, not verified | No index; mixing slow SQL with N+1 |

## Going further

1. Add a GraphQL endpoint with a `customer` field resolver, show the N+1, and fix it with a per-request DataLoader. Assert the query count in a test.
2. Export OpenTelemetry traces for the naive and JOIN routes and compare the staircase with the single span.
3. Add line items and compare one three-way JOIN against batched queries by rows returned, bytes transferred, and latency.
