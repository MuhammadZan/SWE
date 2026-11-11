## Scenario

You're the first senior hire at a company selling a multi-tenant ERP to small manufacturers. The product is a single Node/TypeScript monolith with one Postgres database. It has grown to roughly 300k lines, and the founders want to keep it a monolith for now. Splitting into microservices is "maybe in two years."

The pain is real, though. The `inventory` code imports invoice internals to compute margins. The `billing` code (your own SaaS subscription billing) reads from `sales` tables directly. A change to the `customers` table broke five modules last month. Tenant isolation is enforced in some queries and forgotten in others.

The CTO asks you to produce the **target module architecture**: a diagram and a short write-up the whole team will use as the map for the next year of refactoring. This is a design problem. You're not writing the implementation, but your diagram has to be precise enough that two developers working independently would make compatible decisions from it.

## The domain

The ERP has these capability areas. You decide the final module boundaries, and you may merge or split them:

- **Identity & Tenancy:** tenants, users, roles, permissions, tenant settings (currency, tax region, fiscal year).
- **Catalog:** products, SKUs, units of measure, price lists.
- **Inventory:** warehouses, stock levels, stock movements, reservations, reorder points.
- **Purchasing:** suppliers, purchase orders, goods receipts.
- **Sales:** customers, quotes, sales orders.
- **Invoicing:** invoices, credit notes, payment allocation, invoice numbering per tenant.
- **Accounting:** chart of accounts, journal/ledger entries, fiscal periods.
- **Platform Billing:** the ERP vendor's own subscription billing of tenants (plans, seats, Stripe).
- **Shared Kernel:** `Money`, `TenantId`, `DomainError`, clock and ID generator interfaces.
- **Infrastructure:** Postgres, Redis, S3 (PDF storage), email, Stripe, a background job queue.

Some cross-module flows to support:

1. Confirming a sales order **reserves stock** in Inventory.
2. Issuing an invoice **posts a journal entry** in Accounting and **consumes the reservation** in Inventory.
3. A goods receipt in Purchasing **increases stock** and creates a **payable** entry in Accounting.
4. Platform Billing must **block writes** for tenants whose subscription is past due, without every module knowing about Stripe.

## What to produce

A layered module/dependency diagram on the whiteboard, plus a written explanation (about 500 to 900 words) in your repo's README or a `docs/architecture.md`.

The diagram must make these things unambiguous:

- **Every module as a box**, with its internal layers (domain, application, infrastructure, interface) shown at least for two representative modules.
- **Allowed dependency arrows between modules**, with the direction of each arrow. There must be **no cycles**.
- **Where each port interface sits** (the consuming module's application layer) and which adapter implements it.
- **How cross-module flows happen:** a synchronous call through a module's public API (`index.ts`), or an asynchronous domain event (`InvoiceIssued`, `GoodsReceived`). Mark which flows use which, and why.
- **Where tenant isolation is enforced** (repository layer, request-scoped context, and Postgres RLS if you choose it).
- **The composition root(s)** for the web process and the worker process.

## Constraints

- Inner layers never depend on outer layers (the Dependency Rule), within each module and across modules.
- No module may import another module's `domain/` or `infrastructure/` internals. Only its public API or events.
- Accounting must not depend on Invoicing, Purchasing or Sales. (Hint: who should know about whom when an invoice is posted?)
- The Shared Kernel stays tiny. Justify every item in it.
- Assume a single Postgres database, but each module owns its tables. No cross-module joins in write paths.

## How to verify

- Trace each of the four flows on your diagram with your finger. Every step should follow an allowed arrow.
- Pick any module and ask: "If I deleted this module's infrastructure folder, what would fail to compile?" Only its own composition-root wiring should.
- Look for cycles. If `A -> B` and `B -> A` both exist, invert one with a port or an event.
- Ask a peer, or reread the write-up a day later: could someone add a new "Manufacturing / Bill of Materials" module using only your diagram? Note where they'd plug in.
- Check that every port listed in the diagram names its owner and at least one adapter.
