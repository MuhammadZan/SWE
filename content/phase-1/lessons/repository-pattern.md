## Why this matters

Search your SaaS codebase for `prisma.invoice.` or `db.select().from(invoices)`. In most apps that grew organically you'll find it in route handlers, server actions, cron jobs, React Server Components and a few utility files, often 60 or more call sites. Each one rebuilds part of the same knowledge:

- "Always filter by `tenantId`." Forget this once and you have a data leak between customers.
- "Exclude soft-deleted rows (`deletedAt IS NULL`)."
- "Load the lines with the invoice, in `position` order."
- "Amounts are stored in cents as integers. Convert to `Money`."

Then the business decides to move invoices to a separate database, add read replicas, or replace Prisma. You discover that the data layer *is* your application. The persistence decisions are spread across everything.

The **Repository pattern** puts all of that knowledge behind one interface: a collection-like object that loads and saves domain objects. The rest of the app asks for "invoice 42 for tenant 7" and never sees SQL.

## What a repository is (and isn't)

Martin Fowler's definition (*Patterns of Enterprise Application Architecture*): a repository **mediates between the domain and data mapping layers, acting like an in-memory collection of domain objects.**

That leads to a few concrete properties:

- It speaks the **domain's language**: `findOverdue(tenantId, asOf)`, not `query(sql)`.
- It **returns domain objects**, not ORM rows or raw records.
- It's typically **one per aggregate root**, not one per table. `InvoiceRepository` loads and saves an `Invoice` *with its lines*. There's no `InvoiceLineRepository`.
- Its **interface lives in the application/domain layer**, and its implementation lives in infrastructure. This is the Dependency Rule from lesson 1.

It is **not** a generic wrapper that re-exposes every ORM capability (`findMany(where: any)`). That abstracts nothing.

## Before and after

### Bad: data access mixed into business flow

```ts
export async function POST(req: Request) {
  const { tenantId } = await requireSession(req);
  const body = await req.json();

  const existing = await prisma.user.findFirst({ where: { email: body.email.toLowerCase(), tenantId } });
  if (existing) return new Response("Email taken", { status: 409 });

  const seats = await prisma.user.count({ where: { tenantId, deletedAt: null } });
  const plan = await prisma.subscription.findFirst({ where: { tenantId }, include: { plan: true } });
  if (seats >= plan!.plan.seatLimit) return new Response("Seat limit reached", { status: 402 });

  const user = await prisma.user.create({
    data: { email: body.email.toLowerCase(), name: body.name, tenantId, role: "member" },
  });
  return Response.json(user); // also leaks every column, including future ones like passwordHash
}
```

### Better: a repository interface owned by the application

```ts
// users/domain/user.ts
export class User {
  constructor(
    readonly id: string,
    readonly tenantId: string,
    readonly email: Email,      // value object: validated + normalized
    public name: string,
    public role: Role,
  ) {}
}

// users/application/ports.ts
export interface UserRepository {
  findByEmail(tenantId: string, email: Email): Promise<User | null>;
  countActive(tenantId: string): Promise<number>;
  add(user: User): Promise<void>;
  nextId(): string;
}
export interface SeatPolicy {
  seatLimit(tenantId: string): Promise<number>;
}

// users/application/invite-user.ts
export class InviteUser {
  constructor(private users: UserRepository, private seats: SeatPolicy) {}

  async execute(cmd: { tenantId: string; email: string; name: string }) {
    const email = Email.parse(cmd.email);
    if (await this.users.findByEmail(cmd.tenantId, email)) throw new ConflictError("Email taken");
    if ((await this.users.countActive(cmd.tenantId)) >= (await this.seats.seatLimit(cmd.tenantId)))
      throw new PaymentRequiredError("Seat limit reached");

    const user = new User(this.users.nextId(), cmd.tenantId, email, cmd.name, "member");
    await this.users.add(user);
    return user;
  }
}
```

### The implementation (infrastructure)

```ts
// users/infrastructure/prisma-user-repository.ts
import type { Prisma, User as UserRow } from "@prisma/client";

export class PrismaUserRepository implements UserRepository {
  // TransactionClient accepts both the root PrismaClient and the `tx` client
  // handed out by $transaction, so the same class works inside a Unit of Work
  constructor(private db: Prisma.TransactionClient) {}

  async findByEmail(tenantId: string, email: Email) {
    const row = await this.db.user.findFirst({ where: { tenantId, email: email.value, deletedAt: null } });
    return row ? toDomain(row) : null;
  }
  countActive(tenantId: string) {
    return this.db.user.count({ where: { tenantId, deletedAt: null } });
  }
  async add(user: User) {
    await this.db.user.create({ data: toRow(user) });
  }
  nextId() { return crypto.randomUUID(); }
}

// mapping lives at the edge, in one place
function toDomain(row: UserRow): User {
  return new User(row.id, row.tenantId, Email.parse(row.email), row.name, row.role as Role);
}
function toRow(u: User) {
  return { id: u.id, tenantId: u.tenantId, email: u.email.value, name: u.name, role: u.role };
}
```

The `tenantId` filter and the `deletedAt: null` rule now live in exactly one file. A code reviewer can audit tenant isolation by reading one class instead of 60 call sites.

## Mapping: why not just return the ORM row?

Mapping feels like boilerplate until you need it:

| ORM row | Domain object |
|---|---|
| `totalCents: number` | `total: Money` (amount + currency, safe arithmetic) |
| `status: string` | `status: InvoiceStatus` union, transitions enforced by methods |
| `deletedAt: Date \| null` | Not exposed. Deleted invoices aren't returned |
| `customer_id`, `tenant_id` columns | `customerId`, `tenantId` |
| JSON column `metadata: Prisma.JsonValue` | Typed `PaymentTerms` value object |

Mapping is also what lets you **change storage without changing the domain**. Store `Money` as two columns in Postgres and as a subdocument in MongoDB, and the `Invoice` class doesn't notice. That is exactly the capstone's requirement.

## Designing good repository methods

Good repositories are **narrow and intention-revealing**:

```ts
interface InvoiceRepository {
  get(tenantId: string, id: InvoiceId): Promise<Invoice>;            // throws NotFound
  findByNumber(tenantId: string, number: string): Promise<Invoice | null>;
  findOverdue(tenantId: string, asOf: Date, limit: number): Promise<Invoice[]>;
  save(invoice: Invoice): Promise<void>;                              // insert or update the aggregate
  nextNumber(tenantId: string, year: number): Promise<string>;        // "INV-2026-00042"
}
```

Avoid leaky signatures:

```ts
// Bad: leaks Prisma into the application layer, so swapping the DB breaks every caller
findMany(where: Prisma.InvoiceWhereInput, include?: Prisma.InvoiceInclude): Promise<PrismaInvoice[]>;
```

If the query surface really is dynamic (a filterable list screen with ten optional filters), define a **domain-level criteria type** (`{ status?: InvoiceStatus[]; customerId?: string; dueBefore?: Date }`) or route it to a separate read-side query service (see below).

## Transactions and the Unit of Work

Real use cases change more than one aggregate atomically. Issuing an invoice in an ERP might:

1. mark the invoice as `issued`,
2. decrement inventory for each line,
3. write a ledger entry.

If step 3 fails, steps 1 and 2 must roll back. Repositories each holding their own connection can't guarantee that.

The **Unit of Work** pattern (Fowler again) solves it. A UoW tracks the changes made during a business operation and commits them in one transaction. In TypeScript with Prisma, Drizzle or Knex, the pragmatic version is a **transaction runner that gives you repositories bound to one transaction**:

```ts
// application/ports.ts
export interface UnitOfWork {
  run<T>(work: (repos: TxRepositories) => Promise<T>): Promise<T>;
}
export interface TxRepositories {
  invoices: InvoiceRepository;
  inventory: InventoryRepository;
  ledger: LedgerRepository;
}

// application/issue-invoice.ts
export class IssueInvoice {
  constructor(private uow: UnitOfWork) {}
  execute(tenantId: string, id: InvoiceId) {
    return this.uow.run(async ({ invoices, inventory, ledger }) => {
      const invoice = await invoices.get(tenantId, id);
      invoice.issue();
      for (const line of invoice.lines) {
        const item = await inventory.getBySku(tenantId, line.sku);
        item.ship(line.qty);                     // throws if it would oversell, which rolls everything back
        await inventory.save(item);
      }
      await ledger.append(LedgerEntry.forIssuedInvoice(invoice));
      await invoices.save(invoice);
    });
  }
}

// infrastructure/prisma-unit-of-work.ts
export class PrismaUnitOfWork implements UnitOfWork {
  constructor(private db: PrismaClient) {}
  run<T>(work: (r: TxRepositories) => Promise<T>) {
    return this.db.$transaction((tx) =>
      work({
        invoices: new PrismaInvoiceRepository(tx),
        inventory: new PrismaInventoryRepository(tx),
        ledger: new PrismaLedgerRepository(tx),
      }),
    );
  }
}
```

```
  IssueInvoice.execute
        |
        v
  uow.run( work ) ---- BEGIN ----------------------------------+
        |   invoices.get / inventory.save / ledger.append       |  same tx
        |   any throw  -> ROLLBACK                              |
        +------------- COMMIT ----------------------------------+
```

The use case still never imports Prisma. For this to compile, each Prisma repository's constructor must accept `Prisma.TransactionClient` (as `PrismaUserRepository` does above), not `PrismaClient`. Interactive transactions also have a default timeout of 5 seconds, so keep slow work such as emails and HTTP calls outside `run`. In tests, an `InMemoryUnitOfWork` simply calls `work(fakeRepos)`.

**Concurrency note:** two users issuing invoices that draw on the same stock at the same time can still oversell under default isolation. Add optimistic locking (a `version` column checked in `save`) or `SELECT ... FOR UPDATE` inside the inventory repository's transaction-bound implementation. The domain stays the same, and the repository enforces the guarantee.

## Reads vs. writes: don't force everything through repositories

Repositories are designed for **loading aggregates to change them**. They're a poor fit for:

- dashboards with aggregates across thousands of rows,
- list screens joining five tables with pagination and sorting,
- CSV exports and reports.

For those, use a **query service** (also called a read model or finder) that runs optimized SQL and returns plain DTOs:

```ts
export interface InvoiceListQuery {
  page(tenantId: string, filter: InvoiceListFilter, cursor?: string): Promise<Page<InvoiceListRow>>;
}
```

It still sits behind an interface and still enforces `tenantId`. It simply doesn't pretend to return rich domain objects. This read/write split is how most serious ERPs stay fast without giving up a clean write model.

## When the repository pattern is overkill

Be honest about the costs: more files, mapping code, and an extra layer to jump through.

Skip or simplify it when:

- **The app is a thin CRUD layer** with almost no business rules (an internal admin tool). Calling the ORM from a service is fine.
- **The ORM already gives you what you need**, and you're certain you won't swap persistence or test business rules in isolation.
- **It would be a pass-through generic repository.** `Repository<T>` with `findAll`, `findById`, `create`, `update` and `delete` wrapping Prisma one-to-one adds a layer and removes nothing. Prisma is already a generic repository.

Use it when you have real invariants, multi-tenancy rules to centralize, multiple persistence backends, or a need for fast unit tests of business logic. In practice that covers most SaaS billing, inventory and accounting code.

## Common mistakes

- **Returning ORM types.** `Promise<Prisma.Invoice>` from the interface means the abstraction leaks and every caller is coupled to Prisma.
- **One repository per table.** `InvoiceLineRepository.save(line)` lets callers modify lines without the invoice checking its invariants (totals, status). Save the aggregate as a whole.
- **Business logic inside the repository.** `invoiceRepo.issueAndChargeCustomer()` puts policy in infrastructure. Repositories load and persist. Domain objects and use cases decide.
- **Forgetting tenant scoping in one method.** Make `tenantId` a required parameter on every method (or bind it in the constructor of a request-scoped repository) so it can't be omitted.
- **Repositories opening their own transactions.** Leave transaction boundaries to the use case through a Unit of Work.
- **N+1 inside repositories.** Loading 50 invoices and then lazily fetching each one's lines is still N+1 behind a clean interface. Phase 2 covers how to fix it. Repositories are where the fix lives.

## In the real world

- **Domain-Driven Design** codebases (Eric Evans, Vaughn Vernon) use repositories per aggregate as standard practice. NestJS with TypeORM and MikroORM have built-in repository and Unit of Work concepts. MikroORM's `EntityManager.flush()` is a real Unit of Work.
- **Multi-tenant SaaS** teams often enforce tenant isolation in the repository layer *and* with Postgres Row-Level Security as defense in depth.
- **Migrations between datastores** (moving invoices to a separate DB, moving events to DynamoDB) go far more smoothly when access was already behind repositories. You write a new adapter, run both in parallel, then flip the composition root.
- **Interviews:** "How would you structure data access so business logic is testable?" or "How do you handle a transaction that spans multiple repositories?" Mention the aggregate-root granularity, the Unit of Work, and when you'd skip the pattern.

## Try it

1. Pick one aggregate in your app (Invoice with lines, Order with items, Subscription).
2. Write its repository interface with 3 to 5 intention-revealing methods. Make `tenantId` required everywhere.
3. Implement it twice: once with your real ORM, once as `InMemory...Repository` using a `Map`.
4. Write one **contract test suite**, a function `runInvoiceRepoContract(makeRepo)`, and run it against both implementations. If both pass, they're truly substitutable (LSP).
5. Add a Unit of Work for one use case that touches two aggregates, and write a test showing that a failure in the second step leaves the first unchanged.
