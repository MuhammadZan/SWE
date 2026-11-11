## Why this matters

You have probably shipped a route handler like this. It works and it went to production, and six months later nobody wants to touch it:

```ts
// app/api/invoices/route.ts
export async function POST(req: Request) {
  const body = await req.json();
  const session = await getSession(req);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const customer = await prisma.customer.findFirst({
    where: { id: body.customerId, tenantId: session.tenantId },
  });
  if (!customer) return new Response("Customer not found", { status: 404 });

  let subtotal = 0;
  for (const line of body.lines) {
    const product = await prisma.product.findUnique({ where: { id: line.productId } });
    subtotal += product!.price * line.qty;
  }
  const tax = customer.country === "DE" ? subtotal * 0.19 : subtotal * 0.2;
  const invoice = await prisma.invoice.create({
    data: { customerId: customer.id, tenantId: session.tenantId, subtotal, tax, total: subtotal + tax },
  });
  await fetch("https://api.postmarkapp.com/email", { method: "POST", body: JSON.stringify({ to: customer.email }) });
  return Response.json(invoice);
}
```

Look at what this one function has to know about: HTTP, sessions, Prisma, the tax rules for each country, the Postmark API, and how the response is shaped. These are the problems that come out of that:

- **You can't test the tax logic** unless you start a database and stub out `fetch`.
- **The same invoice logic gets copied** into the CSV import job, the recurring-billing cron, and the public API. Then someone fixes a rounding bug in one copy and the other three keep it.
- **Changing tools hurts.** Moving from Postmark to SES, or from Prisma to Drizzle, means editing business code across dozens of files.
- **New hires can't find where things live.** "Where is the tax rule?" gets the answer "somewhere in a route handler."

Architecture is the set of decisions that tells you **where code goes and what it may depend on**, so that each of those problems has a single obvious fix. This lesson covers the core idea behind layered, hexagonal, onion and clean architecture. They are all variations on the same rule.

## The core idea: separate policy from detail

Every app contains two kinds of code:

- **Policy** is the business rules that would still be true if you printed the app on paper. "An invoice total equals its subtotal plus tax." "You can't ship more stock than you have." "A cancelled subscription keeps access until the period ends."
- **Detail** is the mechanisms that deliver or store policy: HTTP, React, Postgres, Stripe, S3, cron, queues.

Policy is your product. Details are tools you happen to be using right now. A good architecture makes **details depend on policy and never the reverse.**

## The layers

The names differ between authors, but most production backends end up with these four layers:

```
+--------------------------------------------------------------+
|  Interface / Presentation   (HTTP routes, GraphQL, CLI, jobs) |
+--------------------------------------------------------------+
|  Application / Use cases    (CreateInvoice, ReceiveStock)     |
+--------------------------------------------------------------+
|  Domain                     (Invoice, Money, StockLevel rules)|
+--------------------------------------------------------------+
|  Infrastructure             (Prisma repos, Stripe, Postmark)  |
+--------------------------------------------------------------+
```

| Layer | Responsibility | Knows about | Must NOT know about |
|---|---|---|---|
| Interface | Parse input, authenticate, call a use case, format output | Application | SQL, tax rules |
| Application | Orchestrate one user intention: load, call domain, save, notify | Domain, *ports* (interfaces) | HTTP, Prisma, Stripe SDK |
| Domain | Pure business rules and invariants | Nothing but itself | Everything else |
| Infrastructure | Implement ports using real tools | Domain types, ports | Route handlers |

### Domain layer

The domain layer is plain TypeScript with no imports from frameworks. It is the easiest code in the whole system to test.

```ts
// domain/invoice.ts
export class Invoice {
  private constructor(
    readonly id: string,
    readonly tenantId: string,
    readonly customerId: string,
    private lines: InvoiceLine[],
    private status: "draft" | "issued" | "paid" | "void",
  ) {}

  static draft(id: string, tenantId: string, customerId: string): Invoice {
    return new Invoice(id, tenantId, customerId, [], "draft");
  }

  addLine(line: InvoiceLine) {
    if (this.status !== "draft") throw new DomainError("Cannot edit an issued invoice");
    if (line.qty <= 0) throw new DomainError("Quantity must be positive");
    this.lines.push(line);
  }

  subtotal(): Money {
    return this.lines.reduce((sum, l) => sum.add(l.unitPrice.multiply(l.qty)), Money.zero("EUR"));
  }

  issue() {
    if (this.lines.length === 0) throw new DomainError("Cannot issue an empty invoice");
    this.status = "issued";
  }
}
```

There is no `prisma`, no `Request` and no `fetch` in this file. The rule "you can't edit an issued invoice" now lives in exactly one place.

### Application layer (use cases)

A use case is one thing a user wants to do. It coordinates the domain and talks to the outside world only through **ports**, which are interfaces the application layer defines and owns.

```ts
// application/ports.ts
export interface InvoiceRepository {
  save(invoice: Invoice): Promise<void>;
  nextId(): string;
}
export interface CustomerReader {
  findById(tenantId: string, id: string): Promise<CustomerSnapshot | null>;
}
export interface TaxPolicy {
  rateFor(country: string): number;
}
export interface Mailer {
  sendInvoiceIssued(to: string, invoiceId: string): Promise<void>;
}

// application/create-invoice.ts
export class CreateInvoice {
  constructor(
    private invoices: InvoiceRepository,
    private customers: CustomerReader,
    private mailer: Mailer,
  ) {}

  async execute(cmd: { tenantId: string; customerId: string; lines: InvoiceLineInput[] }) {
    const customer = await this.customers.findById(cmd.tenantId, cmd.customerId);
    if (!customer) throw new NotFoundError("customer");

    const invoice = Invoice.draft(this.invoices.nextId(), cmd.tenantId, customer.id);
    for (const l of cmd.lines) invoice.addLine(toLine(l));
    invoice.issue();

    await this.invoices.save(invoice);
    await this.mailer.sendInvoiceIssued(customer.email, invoice.id);
    return invoice;
  }
}
```

### Interface layer

The route handler is now thin. It translates HTTP into a command and the result back into HTTP.

```ts
// app/api/invoices/route.ts
export async function POST(req: Request) {
  const session = await requireSession(req);
  const input = CreateInvoiceSchema.parse(await req.json()); // zod validation
  const invoice = await container.createInvoice.execute({ ...input, tenantId: session.tenantId });
  return Response.json(toInvoiceDto(invoice), { status: 201 });
}
```

The CSV importer, the cron job and the public API can all call `createInvoice.execute(...)`. The logic now exists once.

### Infrastructure layer

The infrastructure layer is where `PrismaInvoiceRepository implements InvoiceRepository` and `PostmarkMailer implements Mailer` live. It is the only place that imports `@prisma/client` or the Postmark SDK.

## The Dependency Rule

This is the single most important sentence in the lesson:

> **Source code dependencies point inward, toward policy. Inner layers never import from outer layers.**

```
        +-------------------------------------------+
        |  Infrastructure / Interface (outer)        |
        |   +-----------------------------------+   |
        |   |  Application (use cases + ports)  |   |
        |   |   +---------------------------+   |   |
        |   |   |   Domain (entities, rules) |   |   |
        |   |   +---------------------------+   |   |
        |   +-----------------------------------+   |
        +-------------------------------------------+
              arrows of "import" point INWARD only
```

So how does a use case save to Postgres if it can't import Prisma? Through **dependency inversion**. The application layer declares the `InvoiceRepository` interface. The infrastructure layer implements it. At startup, a *composition root* wires the concrete implementation into the use case.

```
  CreateInvoice ----uses----> InvoiceRepository (interface, in application/)
                                      ^
                                      | implements
                         PrismaInvoiceRepository (in infrastructure/)
```

At runtime, control flows outward (use case -> Prisma -> DB). At compile time, the import arrow points inward (Prisma repo -> interface). That reversal is the whole trick, and it is why this style is also called *ports and adapters* or *hexagonal* architecture.

## Layered vs. hexagonal vs. clean vs. onion

These names cause a lot of confusion. In short:

- **Classic layered (N-tier):** UI -> Business -> Data. The weakness is that business code imports the data layer, so the database sits at the center.
- **Hexagonal (Ports & Adapters, Alistair Cockburn):** the application sits in the middle. Ports are interfaces. Adapters plug in from both sides: driving adapters such as HTTP and CLI, and driven adapters such as the DB and email.
- **Onion (Jeffrey Palermo)** and **Clean (Robert C. Martin):** concentric circles with the domain at the center, enforcing the same Dependency Rule.

The practical difference between them is small. They all say to keep the database and frameworks at the edge and put the business rules at the center. Pick a vocabulary and use it consistently.

## Folder structure: by layer or by feature?

**Layer-first** looks tidy until you have 40 entities:

```
src/
  controllers/   (40 files)
  services/      (40 files)
  repositories/  (40 files)
```

Changing invoicing means touching three distant folders.

**Feature-first (modular) with layers inside** scales better for ERPs:

```
src/
  modules/
    invoicing/
      domain/         invoice.ts, money.ts
      application/    create-invoice.ts, ports.ts
      infrastructure/ prisma-invoice-repository.ts
      http/           routes.ts
      index.ts        <- the module's public API
    inventory/
      domain/ application/ infrastructure/ http/ index.ts
  shared/
    kernel/          Money, TenantId, DomainError
  main/
    container.ts     <- composition root
```

Modules talk to each other only through their `index.ts`. Inventory never reaches into `invoicing/infrastructure`. This is a **modular monolith**: you get most of the boundary benefits of microservices without the network calls.

## Enforcing the rules

Code reviews alone won't keep this structure intact. Use tooling:

- **ESLint `no-restricted-imports`** or **eslint-plugin-boundaries** to forbid `domain/**` from importing `@prisma/client`, `next/*` or `infrastructure/**`.
- **dependency-cruiser** to fail CI when an import arrow points outward or a module imports another module's internals.
- **TypeScript path aliases** (`@invoicing`, `@inventory`) that point only at each module's `index.ts`.

```js
// .eslintrc excerpt
"no-restricted-imports": ["error", {
  "patterns": [{ "group": ["@prisma/*", "next/*", "**/infrastructure/**"],
                 "message": "Domain/application code must not import infrastructure." }]
}]
```

Apply that rule with an override that targets only `src/modules/*/domain/**` and `src/modules/*/application/**`.

## How much architecture is enough?

Architecture costs indirection: more files, more interfaces, more jumps to find code. Match the investment to how long the code will live and how complex the domain is:

| Situation | Reasonable structure |
|---|---|
| Throwaway prototype, landing page | Route handlers that call the ORM directly. Fine. |
| CRUD admin panel with little logic | Thin service layer plus ORM. Skip the domain classes. |
| SaaS with billing, permissions, multi-tenancy | Use cases plus ports for the DB, payments and email |
| ERP with invoicing, inventory, accounting rules | Full modular layering, rich domain, enforced boundaries |

Domains don't stay simple, though. "Just CRUD" invoicing turns into credit notes, partial payments, multi-currency and audit trails. Introduce the use-case layer early, because it's cheap. Add domain richness when the rules start showing up.

## Common mistakes

- **Anemic domain plus fat services.** Entities become bags of getters and setters, and every rule lives in a 900-line `InvoiceService`. That is a procedural script with extra files. Push invariants such as "can't edit issued invoices" into the entity.
- **Leaking ORM types upward.** A use case that returns a `Prisma.Invoice` or accepts a `Prisma.InvoiceWhereInput` has quietly broken the Dependency Rule. Map to domain types at the boundary.
- **Interfaces in the wrong place.** If `InvoiceRepository` lives in `infrastructure/`, the application imports infrastructure again. The *consumer* owns the port.
- **Business logic in controllers or React components.** Tax calculations in a route handler, or discount rules in a `useMemo`, can't be reused by the cron job or the API.
- **Over-layering trivial code.** A `GetUserByIdUseCase` that only calls `repo.findById` adds nothing. It's acceptable to let simple queries go straight to a read model. See "CQRS-lite" below.
- **Treating folders as architecture.** Having a `domain/` folder means nothing if it imports Prisma. The import graph is the architecture.

## In the real world

- **Read vs. write paths (CQRS-lite).** Many production codebases route *writes* through use cases and the domain, and serve *reads* (lists, dashboards, reports) through optimized SQL query services that return DTOs directly. Invoice list pages don't need a rich `Invoice` aggregate. This is pragmatic, and it's common in ERPs.
- **NestJS** makes modules, providers and injection explicit. Teams on Express or Next.js usually build the same structure by hand with a `container.ts`.
- **Modular monoliths** such as Shopify's core are the industry's answer to "microservices too early." Strong module boundaries come first, and splitting into services happens only when needed.
- **Interviews.** Expect "How would you structure a backend so you can swap the payment provider?" or "Where would you put the logic that prevents overselling inventory?" Answer with the Dependency Rule, a port in the application layer, an adapter in infrastructure, and the invariant in the domain. Then mention the trade-off of extra indirection.

## Try it

Take one route handler from a project you've shipped, ideally one that creates or updates something with real business rules (an order, invoice, booking or subscription change).

1. List every concern in it: HTTP parsing, auth, validation, business rules, DB access, side effects such as email or webhooks.
2. Sketch the four layers on paper and assign each line of the handler to one.
3. Write the use case class with its ports as interfaces. Don't implement the adapters yet.
4. Write one unit test for the use case using in-memory fakes for every port. If the test needs a database, a port is missing.
5. Draw the import graph. Every arrow should point inward. Circle any that don't.
