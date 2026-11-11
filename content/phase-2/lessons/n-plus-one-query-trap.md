## Why this matters

The invoice list endpoint returns 50 invoices with each customer's name, billing address, and payment terms, each loaded lazily. Locally it responds in 60 ms. In production, against a managed Postgres in a different availability zone, it takes 900 ms. The database dashboard shows nothing alarming: every individual query takes under 2 ms. No single query is slow. There are just 151 of them per request.

This is the N+1 query problem: one query to fetch a list of N items, then N more queries to fetch something related for each item. It is the most common performance bug in ORM-based applications, it is invisible in code review if you do not know to look for it, and it gets worse with every network hop between your app and your database.

## The anatomy of N+1

```
Request: GET /invoices?limit=50

  app                                  database
   |-- SELECT * FROM invoices LIMIT 50 -->|   1 query
   |<----------- 50 rows -----------------|
   |-- SELECT * FROM customers WHERE id=1 >|  \
   |<-------------------------------------|   |
   |-- SELECT * FROM customers WHERE id=2 >|   |  50 queries
   |<-------------------------------------|   |  (one per invoice)
   |   ...                                |   |
   |-- SELECT * FROM customers WHERE id=50>|  /
   |<-------------------------------------|

  total: 51 round trips
```

The cost per query is mostly not Postgres work. It is the round trip: network latency, connection-pool checkout, protocol overhead, query parsing, result serialization, and ORM hydration. At 3 ms per round trip, 51 queries cost about 150 ms of pure waiting even if each query does almost nothing. Add a second relation (billing address, line items) and it becomes 2N+1 or worse.

In Big-O terms the number of round trips is `O(n)` when it should be `O(1)`. Each unit of that `O(n)` costs milliseconds, not nanoseconds.

## How it hides in ORM code

### Lazy loading in a loop (TypeORM-style)

```ts
// Entity with a lazy relation
@Entity()
class Invoice {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column() number!: string;
  @ManyToOne(() => Customer, { lazy: true }) customer!: Promise<Customer>;
}

// Looks innocent
const invoices = await invoiceRepo.find({ take: 50 });
for (const inv of invoices) {
  const customer = await inv.customer; // one query per invoice
  console.log(inv.number, customer.billingAddress);
}
```

### Explicit fetch in a loop (Prisma-style)

```ts
const invoices = await prisma.invoice.findMany({ take: 50 });

const rows = await Promise.all(
  invoices.map(async (inv) => {
    const customer = await prisma.customer.findUnique({ where: { id: inv.customerId } });
    return { number: inv.number, address: customer?.billingAddress };
  }),
);
```

`Promise.all` makes this *concurrent*, which feels like a fix. It is not. It still fires 50 queries, now grabbing up to 50 connections from the pool at once. Under load this exhausts the pool and makes every other request wait.

### Hidden inside a serializer or resolver

```ts
// GraphQL resolver: runs once per invoice in the list
const resolvers = {
  Invoice: {
    customer: (inv: Invoice) => prisma.customer.findUnique({ where: { id: inv.customerId } }),
  },
};
```

The list query is one line in one file; the per-item query is in another file. Neither looks wrong on its own. GraphQL makes N+1 the default unless you deliberately batch.

### Nested N+1

```ts
for (const order of orders) {                         // N orders
  const lines = await getLines(order.id);             // N queries
  for (const line of lines) {
    const product = await getProduct(line.productId); // N * L queries
  }
}
```

50 orders with 20 lines each is 1 + 50 + 1,000 queries.

## Step one: make it visible with query logging

You cannot fix what you cannot see. Turn on logging in development and count queries per request.

Prisma:

```ts
const prisma = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
prisma.$on("query", (e) => console.log(`${e.duration}ms ${e.query}`));
```

TypeORM:

```ts
new DataSource({ /* ... */ logging: ["query"], maxQueryExecutionTime: 100 });
```

Raw `pg` (wrap the query function):

```ts
let queryCount = 0;
const originalQuery = pool.query.bind(pool);
pool.query = ((...args: Parameters<typeof originalQuery>) => {
  queryCount++;
  return originalQuery(...args);
}) as typeof pool.query;
```

Postgres itself (development only, very noisy):

```sql
ALTER SYSTEM SET log_statement = 'all';
SELECT pg_reload_conf();
```

The most useful habit: a per-request query counter. Store a counter in `AsyncLocalStorage`, increment it on every query, and log a warning when a request exceeds a threshold (say 20). This catches N+1 regressions the day they are introduced.

Increment it from code that runs in the caller's async context: a wrapped `pool.query`, or a Prisma client extension. Prisma's `$on("query")` log event is emitted from the query engine and is not guaranteed to run inside the request's `AsyncLocalStorage` context, so `getStore()` can come back `undefined` there. Note also that an extension counts Prisma *operations*; one `findMany` with `include` can run two or three SQL statements, so confirm against the SQL log when the exact number matters.

```ts
import { AsyncLocalStorage } from "node:async_hooks";
const reqCtx = new AsyncLocalStorage<{ queries: number; path: string }>();

app.use((req, res, next) => {
  const ctx = { queries: 0, path: req.path };
  res.on("finish", () => {
    if (ctx.queries > 20) console.warn(`N+1 suspect: ${ctx.path} ran ${ctx.queries} queries`);
  });
  reqCtx.run(ctx, next);
});

const db = prisma.$extends({
  query: {
    async $allOperations({ args, query }) {
      const c = reqCtx.getStore();
      if (c) c.queries++;
      return query(args);
    },
  },
});
// use `db` (not `prisma`) everywhere in request handlers
```

## Fix 1: a JOIN

When you need one related row per parent (many-to-one), a JOIN returns everything in a single round trip.

```sql
SELECT i.id, i.number, i.total_cents, c.name, c.billing_address
FROM invoices i
JOIN customers c ON c.id = i.customer_id
WHERE i.tenant_id = $1
ORDER BY i.issued_at DESC
LIMIT 50;
```

One query. Make sure `customers.id` is the primary key (it is indexed) and that the invoice filter and sort are indexed; the JOIN then costs 50 primary-key lookups inside Postgres, which take microseconds.

## Fix 2: eager loading in the ORM

ORMs let you declare relations to load up front.

Prisma:

```ts
const invoices = await prisma.invoice.findMany({
  where: { tenantId },
  orderBy: { issuedAt: "desc" },
  take: 50,
  select: {
    id: true,
    number: true,
    totalCents: true,
    customer: { select: { name: true, billingAddress: true } },
  },
});
```

TypeORM:

```ts
const invoices = await invoiceRepo.find({
  where: { tenantId },
  order: { issuedAt: "DESC" },
  take: 50,
  relations: { customer: true },
});

// or with the query builder
const invoices2 = await invoiceRepo
  .createQueryBuilder("i")
  .leftJoinAndSelect("i.customer", "c")
  .where("i.tenantId = :tenantId", { tenantId })
  .orderBy("i.issuedAt", "DESC")
  .take(50)
  .getMany();
```

Check the logs after switching. ORMs implement eager loading in one of two ways:

1. **A JOIN** in a single query.
2. **A second query with `WHERE id IN (...)`**, then stitching in memory. Prisma has historically done this for relations (since 5.8 it can use database-level joins via `relationLoadStrategy: "join"`; depending on your version this sits behind the `relationJoins` preview feature).

Both are fine. Two queries is not N+1. What matters is that the query count is constant regardless of how many rows you load.

## Fix 3: batch with IN / ANY and stitch with a Map

When you cannot change the original query (it comes from another module, or you are adding data to an existing list), batch the follow-up:

```ts
const invoices = await listInvoices(tenantId); // existing function, 50 rows

const ids = [...new Set(invoices.map((i) => i.customerId))];
const customers = await prisma.customer.findMany({ where: { id: { in: ids } } });
const byId = new Map(customers.map((c) => [c.id, c]));

const rows = invoices.map((i) => ({ ...i, customer: byId.get(i.customerId) ?? null }));
```

Two queries total, regardless of N. This is the Map pattern from the hash maps lesson applied across a network boundary.

## Fix 4: DataLoader for resolvers and deep call trees

When per-item fetches are scattered across code you do not want to restructure (GraphQL resolvers, serializers, domain services), DataLoader collects all `load(id)` calls made in the same tick of the event loop and turns them into one batch call.

```ts
import DataLoader from "dataloader";

function createLoaders() {
  return {
    customer: new DataLoader<string, Customer | null>(async (ids) => {
      const rows = await prisma.customer.findMany({ where: { id: { in: [...ids] } } });
      const byId = new Map(rows.map((r) => [r.id, r]));
      return ids.map((id) => byId.get(id) ?? null); // MUST return in the same order as ids
    }),
  };
}

// One set of loaders per request (never global: it caches, and would leak data across users)
const loaders = createLoaders();

const resolvers = {
  Invoice: {
    customer: (inv: Invoice) => loaders.customer.load(inv.customerId),
  },
};
```

```
tick 1:  load(c1) load(c2) load(c1) load(c3) ... (50 calls)
         \_____________________________________/
                         |
end of tick:   batchFn([c1, c2, c3, ...unique ids])  ->  1 query
```

Two rules:

- **The batch function must return results in the same order and length as the input keys.** Use a Map to reorder; the database does not guarantee order.
- **Create loaders per request.** DataLoader also caches within its lifetime. A global loader serves stale data and can leak one tenant's data to another.

## Watch for the opposite problem

Over-eager loading has costs too:

- **Cartesian explosion.** JOINing invoices to line items *and* to payments in one query multiplies rows: 50 invoices x 20 lines x 3 payments = 3,000 rows, mostly duplicated data. Load one-to-many relations separately (two or three queries) rather than in one giant JOIN.
- **Loading relations you do not render.** `include: { customer: true, lines: true, payments: true, auditLog: true }` on a list view that shows four columns. Select only what the screen needs.
- **Huge `IN` lists.** `IN` with 50,000 IDs works but is slow to parse and plan. If you are batching that many, you probably want a JOIN or a different query shape.

## Common mistakes

- **Thinking `Promise.all` fixes N+1.** It parallelizes the queries and drains your connection pool.
- **Testing with 3 rows.** 3+1 queries feels fine. Seed realistic list sizes.
- **Global DataLoader instances.** Stale caches and cross-tenant data leaks.
- **Batch functions that return results in database order** instead of key order, silently attaching the wrong customer to an invoice.
- **Fixing the list endpoint but not the export.** Exports and background jobs process thousands of rows and are where N+1 becomes catastrophic.
- **Never looking at the logs.** Most teams discover N+1 only after a production incident.

## In the real world

APM tools (Datadog, New Relic, Sentry Performance, OpenTelemetry traces) show a request as a waterfall of spans. N+1 looks like a staircase of identical short database spans, and many tools flag it automatically. Rails has the Bullet gem; in the Node world, the AsyncLocalStorage query counter above is a cheap equivalent.

Teams that take this seriously add a test assertion: "the invoice list endpoint runs at most 3 queries for 50 invoices", which fails CI when someone adds a lazy relation access to a serializer. That turns a performance property into a regression-tested contract.

## Try it

1. Seed 500 customers and 10,000 invoices. Build `GET /invoices?limit=50` that returns invoice number, total, customer name, and billing address using the naive per-invoice lookup.
2. Turn on query logging and confirm 51 queries. Measure response time over 100 requests.
3. Fix it three ways: a raw SQL JOIN, ORM eager loading, and `IN` plus a Map. Confirm the query count and measure again.
4. Add line items to the response. Compare one big JOIN against a separate batched query for lines. Count returned rows in each case.
5. Add the per-request query counter middleware and make it fail a test if a request exceeds 5 queries.
