## What a strong solution looks like

A strong answer reads like a map the team can actually follow. Modules are arranged by stability: the Shared Kernel and Identity & Tenancy at the bottom, Catalog above them, then Inventory, Purchasing, Sales and Invoicing, with Accounting kept independent of them all. Every arrow means "imports the public API of" and points from the more volatile module to the more stable one. There are no cycles, and the author can explain each place where a cycle was tempting and how it was broken with a port or an event.

The write-up treats sync and async deliberately. Calls that must succeed in the same transaction for the user's action to make sense (reserving stock when confirming an order) are synchronous public-API calls. Consequences that can lag slightly and are owned by another team (posting to the ledger, updating stock on goods receipt) are events, delivered through an outbox so they are never lost. Tenant isolation is enforced in more than one place, and the web and worker composition roots are both shown. The Shared Kernel is genuinely small, and each item in it is justified.

## Reference approach

A reference layout (arrows are compile-time dependencies; `~~>` is an async event):

```
                 +-----------+    +-----------+
                 |   Sales   |    | Purchasing|
                 +-----+-----+    +-----+-----+
       reserve() sync  |                |  ~~> GoodsReceived
                       v                v
   +-----------+   +-----------+      (Inventory and Accounting react)
   | Invoicing |-->| Inventory |
   +-----+-----+   +-----------+
         |  ~~> InvoiceIssued
         v
   (handler calls Accounting's public API with an
    Accounting-defined PostJournalEntry command)
         |
   +-----+------+   +----------------+   +------------------+
   | Accounting |   | Platform Billing|  | Catalog          |
   +-----+------+   +-------+--------+   +--------+---------+
         |                  | implements           |
         v                  v TenantWriteGuard     v
   +---------------------------------------------------------+
   |  Identity & Tenancy (tenants, users, settings, guard port)|
   +---------------------------------------------------------+
   |  Shared Kernel: Money, TenantId, DomainError, Clock, Ids |
   +---------------------------------------------------------+
```

How the four flows work:

| Flow | Mechanism | Reasoning |
|---|---|---|
| Sales order confirmed reserves stock | Sync: Sales calls `inventory.reserve(tenantId, lines)` via Inventory's `index.ts` | The user needs an immediate yes/no; overselling is the main business risk |
| Invoice issued posts journal entry | Async: Invoicing publishes `InvoiceIssued`; Accounting's handler translates it into its own `PostJournalEntry` command | Accounting must not depend on Invoicing; a short delay in the ledger is acceptable |
| Invoice issued consumes reservation | Sync: Invoicing calls `inventory.ship(...)` inside the issuing transaction | Stock and invoice status must change together |
| Goods receipt increases stock and payable | Async: Purchasing publishes `GoodsReceived`; Inventory and Accounting subscribe | Two independent consequences, neither needed for the receipt screen to complete |
| Past-due tenants blocked | Port `TenantWriteGuard` owned by Identity & Tenancy (or each module's application layer), implemented by Platform Billing | Modules ask "may this tenant write?" without knowing Stripe exists |

Note the subtlety in the Accounting flow: the event handler that maps `InvoiceIssued` to a journal entry has to live somewhere that knows both. Putting it in Accounting means Accounting imports Invoicing's event type, which breaks the constraint. The clean options are an integration handler on the Invoicing side that calls Accounting's public API with an Accounting-defined command, or events defined in a tiny published-contracts package that both depend on. Either is acceptable if stated.

**Port table excerpt:**

| Port | Owner (module/layer) | Adapters |
|---|---|---|
| `InvoiceRepository` | Invoicing / application | `PostgresInvoiceRepository` |
| `StockReservations` | Inventory / application (exposed via `index.ts`) | Postgres adapter |
| `TenantWriteGuard` | Identity & Tenancy / application | `BillingTenantWriteGuard` (Platform Billing infra), `AllowAllGuard` (tests) |
| `EventPublisher` | Shared Kernel interface | `OutboxEventPublisher` (writes to `outbox` table in the same tx) |
| `PdfStorage` | Invoicing / application | `S3PdfStorage`, `LocalFsPdfStorage` |

**Tenant isolation**: a request-scoped context created in the interface layer from the session, `tenantId` required on every repository method, and Postgres RLS (`SET LOCAL app.tenant_id` per transaction) as a backstop. The worker composition root builds the same request scope from the tenant ID stored in each job or event.

**Back-of-envelope numbers.** At 300k lines, roughly 8 modules of 20–60k lines each is a size a small team can own. If 500 tenants issue an average of 200 invoices a day, that's about 100k `InvoiceIssued` events a day, or roughly 1–2 per second on average with peaks perhaps 10 times higher. An outbox table polled every second by one worker handles that comfortably. Nothing here justifies a message broker yet, which is itself a useful conclusion to state.

## Common mistakes

- **A "Common" or "Core" module that everything depends on and that keeps growing.** Customers, products and helpers end up in the Shared Kernel, and it becomes the new monolith. Customers belong to Sales; products belong to Catalog.
- **Accounting importing Invoicing types** to read invoice data, violating the stated constraint.
- **Arrows without direction or meaning.** "These talk to each other" lines can't be turned into lint rules or code reviews.
- **Every flow as an event.** Stock reservation via an event means the UI can't tell the user whether the order was confirmed. Asynchrony has a cost and should be chosen per flow.
- **Events with no delivery guarantee.** Publishing after the commit with an in-process emitter loses events on crash. An outbox (or at least an acknowledgement of the risk) is expected.
- **Tenant isolation as a single box labeled "middleware".** Middleware sets the context; enforcement happens in repositories and, ideally, the database.
- **Forgetting the worker process.** Background jobs need their own composition root and tenant context, and are where isolation bugs usually hide.

## Trade-offs worth discussing

- **Eventual consistency.** The ledger lags invoices by seconds. What does the month-end close do about events still in flight? (A common answer: close the period only after the outbox is drained.)
- **Single database, separate ownership.** Sharing Postgres keeps transactions and backups simple, but makes cross-module joins tempting. Reporting may get an explicit read-model exception.
- **Where the tenant guard is called.** In each use case (explicit, easy to forget) versus in a decorator around all write use cases (automatic, more magic).
- **Shared event contracts versus translation.** A published-contracts package is simple but couples schemas; per-consumer translation is more decoupled but adds code.
- **Extraction path.** Which module would you extract first, and why? Platform Billing and Accounting usually have the cleanest seams.

## Grade yourself

| Dimension | Strong | Acceptable | Needs work |
|---|---|---|---|
| Module boundaries | Every capability placed, merges/splits justified, Shared Kernel has 4–6 justified items | All capabilities placed, little justification | Catch-all "common" module, or capabilities missing |
| Dependency graph | Directed, acyclic, stable modules at the bottom; tempting cycles explicitly broken with ports or events | Acyclic but with some unexplained arrows | Cycles present, or arrows lack direction |
| Cross-module flows | All four traced, each labeled sync or async with a reason; outbox or delivery guarantee stated | All four traced, labels without reasoning | Flows missing or all handled the same way without thought |
| Ports and adapters | Table of every port with owner layer and at least one adapter; ports owned by consumers | Most ports listed, some owners ambiguous | Ports owned by infrastructure or not shown |
| Tenant isolation | Context creation, repository enforcement, optional RLS, and worker path all marked | Repository enforcement marked only | Isolation mentioned but not located |
| Write-up | 500–900 words, names costs (eventual consistency, indirection) and the Manufacturing extension point | Explains the boundaries but not the costs | Restates the diagram without reasoning |

## Going further

1. Encode the allowed arrows as dependency-cruiser rules (`forbidden` with `from`/`to` path patterns) and run them on a skeleton repo with empty modules.
2. Specify the `InvoiceIssued` payload (with a schema version), the outbox table, and how consumers stay idempotent.
3. Draw the "after extraction" diagram for Accounting as a separate service, and list exactly which arrows become network calls or message queue topics.
