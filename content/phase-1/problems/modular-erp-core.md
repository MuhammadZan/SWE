## Scenario

This is the Phase 1 capstone. You'll rebuild the **invoicing and core inventory logic of an ERP** as a modular TypeScript backend, with an architecture strict enough that you can **switch the entire persistence provider (PostgreSQL to MongoDB) by changing one configuration value**, without touching a single line of business logic.

This isn't just a demo of swapping databases. Database portability is the *test* that proves your boundaries are real. If the domain or use cases leak even one ORM type, the swap will expose it.

## Business rules to implement

Implement these rules exactly. They are the "policy" your architecture protects.

**Inventory**
- A product has a SKU, a name, a unit price (`Money`), and stock levels per warehouse.
- Receiving goods increases `onHand` for a SKU in a warehouse and records a `StockMovement` (type `receipt`).
- Stock can be **reserved** for a draft invoice. `available = onHand - reserved`. A reservation that exceeds `available` must fail.
- Shipping (on invoice issue) decreases `onHand` and releases the matching reservation.

**Invoicing**
- An invoice belongs to a tenant and a customer and has lines (`sku`, `qty`, `unitPrice`), status `draft -> issued -> paid`, or `draft -> void`, or `issued -> void` (void after issue restocks the items).
- Lines can only change while the invoice is in `draft`. Adding a line reserves stock, and removing one releases it.
- **Issuing** assigns a sequential, gap-free number per tenant per year (`INV-2026-00001`), converts reservations into shipments, and is **atomic**: if any step fails, nothing changes.
- Totals: `subtotal = sum(qty * unitPrice)`, `tax = subtotal * tenantTaxRate` rounded half-even to 2 decimals, `total = subtotal + tax`. Use integer minor units or a decimal library. **Never float arithmetic on money.**
- Recording a payment equal to the outstanding amount marks the invoice `paid`. Partial payments are allowed and tracked.

**Multi-tenancy**
- Every operation is scoped to a `tenantId`. No query may return another tenant's data.

## Starting point

Suggested layout (adapt it as you like, but keep the separation):

```
src/
  shared/kernel/          Money, TenantId, DomainError, Clock, IdGenerator
  modules/
    inventory/
      domain/  application/  infrastructure/postgres/  infrastructure/mongo/  http/  index.ts
    invoicing/
      domain/  application/  infrastructure/postgres/  infrastructure/mongo/  http/  index.ts
  main/
    config.ts             // reads PERSISTENCE=postgres|mongo
    container.ts          // composition root: the ONLY place that branches on it
    server.ts
test/
  contract/               // repository contract tests run against BOTH providers
```

The composition root is the heart of the swap:

```ts
const persistence = config.persistence === "mongo"
  ? await makeMongoPersistence(config.mongoUrl)       // returns { uow, invoiceQueries, ... }
  : await makePostgresPersistence(config.postgresUrl);

export const container = {
  issueInvoice: new IssueInvoice(persistence.uow, clock),
  // ...
};
```

## What to build

1. Domain models (`Invoice`, `InvoiceLine`, `StockItem`, `Money`) with invariants enforced inside them, and no framework imports.
2. Use cases: `CreateDraftInvoice`, `AddInvoiceLine`, `RemoveInvoiceLine`, `IssueInvoice`, `VoidInvoice`, `RecordPayment`, `ReceiveStock`, `GetStockLevel`.
3. Ports: repositories per aggregate, a `UnitOfWork`, an `InvoiceNumberSequence`, and a read-side `InvoiceQueries` for listing.
4. **Two complete persistence adapters:** PostgreSQL (SQL, Prisma, Drizzle or Knex) and MongoDB (official driver or Mongoose). Each provides its own Unit of Work (Postgres transactions, Mongo multi-document transactions on a replica set).
5. A thin HTTP API (REST is fine) exposing the use cases.
6. A `docker-compose.yml` that starts Postgres and a single-node Mongo replica set.
7. The architecture diagram (see the design prompt): hexagon/ports-and-adapters view with both adapters and the composition root.

## Constraints

- `domain/` and `application/` folders may not import `pg`, `@prisma/client`, `drizzle-orm`, `mongodb`, `mongoose`, `express` or any other infrastructure package. Enforce it in CI with dependency-cruiser or ESLint boundaries.
- Switching providers is done only by setting `PERSISTENCE=mongo` (env or config file). Zero edits elsewhere.
- No DI framework. Use manual constructor injection.
- No floating-point money.
- Write it yourself. AI is for documentation lookup only.

## How to verify

- **Contract tests:** one repository/UoW test suite, parameterized by provider, runs green against both Postgres and Mongo.
- **Use-case tests:** run against in-memory fakes in under 2 seconds total, with no database.
- **Atomicity test:** force the ledger/number step to throw during `IssueInvoice` and assert that stock, reservations and invoice status are unchanged, on both providers.
- **Concurrency test:** fire 20 parallel `AddInvoiceLine` calls against a SKU with stock for 10. Exactly 10 succeed. Fire parallel `IssueInvoice` calls for one tenant and confirm the numbers are gap-free and unique.
- **Isolation test:** tenant A can't read, issue or pay tenant B's invoice by ID.
- **The swap:** run the full end-to-end script (create, add lines, issue, pay) with `PERSISTENCE=postgres`, then with `PERSISTENCE=mongo`. Then run `git diff` and confirm that only the config value changed.
