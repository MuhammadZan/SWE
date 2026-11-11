## Scenario

Your SaaS has an "Invoices" screen that lists the 50 most recent invoices with the customer's name and billing address. Customers in a distant region report the page is sluggish. The database dashboard shows no slow queries. You suspect the N+1 query problem, and you want to prove it with logs, fix it, and add a guard so it cannot silently come back.

## Starting point

Set up Postgres locally (Docker is easiest: `docker run -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:17`). Use an ORM you know (Prisma or TypeORM) for the "realistic" version, plus raw `pg` for the SQL version.

Schema:

```sql
CREATE TABLE customers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     text NOT NULL,
  name          text NOT NULL,
  email         text NOT NULL
);

CREATE TABLE addresses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   uuid NOT NULL REFERENCES customers(id),
  kind          text NOT NULL CHECK (kind IN ('billing', 'shipping')),
  line1         text NOT NULL,
  city          text NOT NULL,
  country       text NOT NULL
);

CREATE TABLE invoices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     text NOT NULL,
  customer_id   uuid NOT NULL REFERENCES customers(id),
  number        text NOT NULL,
  total_cents   bigint NOT NULL,
  issued_at     timestamptz NOT NULL
);
```

Seed 2,000 customers (each with a billing and a shipping address) and 100,000 invoices across 5 tenants. Write the seed script yourself, using batched multi-row inserts or `COPY`, not one insert per row.

The naive endpoint (adapt to your ORM):

```ts
app.get("/invoices", async (req, res) => {
  const invoices = await prisma.invoice.findMany({
    where: { tenantId: req.query.tenant as string },
    orderBy: { issuedAt: "desc" },
    take: 50,
  });
  const rows = [];
  for (const inv of invoices) {
    const customer = await prisma.customer.findUnique({ where: { id: inv.customerId } });
    const billing = await prisma.address.findFirst({
      where: { customerId: inv.customerId, kind: "billing" },
    });
    rows.push({ number: inv.number, total: inv.totalCents, customer: customer!.name, billing });
  }
  res.json(rows);
});
```

## What to build

1. **Query logging.** Enable your ORM's query log, and separately enable Postgres statement logging (`log_statement = 'all'` in development). Capture the log for one request to the naive endpoint and confirm the count: 1 + 50 + 50 = 101 queries.
2. **A per-request query counter** using `AsyncLocalStorage` that adds an `X-Query-Count` response header and logs a warning when a request exceeds 10 queries.
3. **Three fixed versions**, each behind its own route:
   - `/invoices/join`: one raw SQL query using `JOIN` for customer and billing address.
   - `/invoices/eager`: ORM eager loading (`include`/`select` in Prisma, `relations` or `leftJoinAndSelect` in TypeORM).
   - `/invoices/batched`: the original list query plus one `WHERE id = ANY(...)` query for customers and one for billing addresses, stitched with Maps.
4. **Simulated network latency.** Run your app against Postgres through a latency proxy (for example `toxiproxy` adding 5 ms) or, more simply, wrap the query function with a 5 ms delay in a "remote mode" flag. This shows what N+1 does across a real network.
5. **A regression test** that calls each fixed route and asserts the query count is at most 3, and that the response data is identical to the naive route's data.

## Constraints

- All four routes return exactly the same JSON for the same tenant.
- `Promise.all` over per-invoice queries does not count as a fix. You may include it as a fifth variant to demonstrate that it reduces latency but not query count, and observe its effect on the connection pool (set the pool size to 10 to make it visible).
- Write SQL and Map stitching by hand.
- Make sure the list query itself is indexed (`invoices (tenant_id, issued_at DESC)`), and that `addresses (customer_id, kind)` is indexed, so you measure round trips rather than missing indexes.

## How to measure and verify

- For each route, record: query count (from your header), p50 and p95 latency over 200 requests with `autocannon -c 10 -a 200`, both with and without the 5 ms simulated latency.
- Put a table in the README:

| route | queries | p50 local | p95 local | p50 +5ms | p95 +5ms |
|---|---|---|---|---|---|

- Expected shape: the naive route should be roughly 100 x 5 ms = 500 ms or more in remote mode, and the fixed routes should stay within a small multiple of a single round trip.
- Include a short excerpt of the raw query log for the naive route and for the JOIN route in the README.
- Explain in two or three sentences which fix you would choose for a REST endpoint and which for a GraphQL resolver, and why.
