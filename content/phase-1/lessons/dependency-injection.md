## Why this matters

You want to test one rule: "When stock for a SKU falls below its reorder point, create a purchase order draft and notify the purchasing manager." Here's the code:

```ts
import { db } from "@/lib/db";
import { slack } from "@/lib/slack";

export async function recordShipment(sku: string, qty: number) {
  const item = await db.inventoryItem.update({ where: { sku }, data: { onHand: { decrement: qty } } });
  if (item.onHand < item.reorderPoint) {
    await db.purchaseOrder.create({ data: { sku, qty: item.reorderQty, status: "draft" } });
    await slack.chat.postMessage({ channel: "#purchasing", text: `Reorder ${sku}` });
  }
}
```

To test it you need a real database (seeded), a Slack token, or `jest.mock("@/lib/db")` module patching that breaks whenever someone renames an import. Your test suite takes four minutes and fails randomly when Slack rate-limits CI.

The cause is that **the function reaches out and grabs its own dependencies.** Dependency Injection (DI) reverses that: a component *receives* what it needs instead of fetching or constructing it. That one change makes code testable, swappable and honest about its dependencies.

## The concept in one sentence

> Don't let a class create or look up its collaborators. Hand them in.

That's all DI is. Containers, decorators and frameworks are optional tooling on top of it.

## Three ways to get a dependency

```ts
// 1. Construct it yourself (hardwired)
class ReorderService {
  private repo = new PrismaInventoryRepository();     // can't replace it
}

// 2. Look it up from a global (service locator / module singleton)
class ReorderService {
  run() { const repo = globalContainer.get("inventoryRepo"); } // hidden dependency
}

// 3. Receive it (injection)
class ReorderService {
  constructor(private repo: InventoryRepository) {}   // explicit, replaceable
}
```

Options 1 and 2 hide dependencies. You can't tell from the signature what `ReorderService` needs, and tests have to patch globals. Option 3 makes the dependency part of the public contract.

## Constructor injection (the default)

Constructor injection is the right default for almost everything:

```ts
// inventory/application/ports.ts
export interface InventoryRepository {
  getBySku(tenantId: string, sku: string): Promise<InventoryItem>;
  save(item: InventoryItem): Promise<void>;
}
export interface PurchaseOrderDrafts {
  createDraft(tenantId: string, sku: string, qty: number): Promise<string>;
}
export interface Notifier {
  notifyPurchasing(tenantId: string, message: string): Promise<void>;
}
export interface Clock { now(): Date }

// inventory/application/record-shipment.ts
export class RecordShipment {
  constructor(
    private readonly inventory: InventoryRepository,
    private readonly purchaseOrders: PurchaseOrderDrafts,
    private readonly notifier: Notifier,
    private readonly clock: Clock,
  ) {}

  async execute(tenantId: string, sku: string, qty: number) {
    const item = await this.inventory.getBySku(tenantId, sku);
    item.ship(qty, this.clock.now());          // domain rule: can't go negative
    await this.inventory.save(item);

    if (item.needsReorder()) {
      const poId = await this.purchaseOrders.createDraft(tenantId, sku, item.reorderQty);
      await this.notifier.notifyPurchasing(tenantId, `Draft PO ${poId} created for ${sku}`);
    }
  }
}
```

Why the constructor:

- **Dependencies are visible in one place.** Six constructor parameters is a code smell you can actually see, which is the SRP warning light.
- **The object is never half-built.** It's fully usable as soon as `new` returns.
- **`readonly` dependencies** can't be swapped in the middle of a request.

### Other forms, and when to use them

| Form | Example | Use when |
|---|---|---|
| Constructor | `new RecordShipment(repo, ...)` | Default for services and use cases |
| Method/parameter | `exporter.export(rows, writer)` | The dependency varies per call |
| Function arguments / closures | `makeRecordShipment({ repo, notifier })` | Functional style, no classes |
| Property/setter | `service.logger = x` | Almost never. It allows half-initialized objects |

DI doesn't require classes. A factory function closing over its dependencies is equally valid and very common in TypeScript:

```ts
export const makeRecordShipment = (deps: { inventory: InventoryRepository; notifier: Notifier; clock: Clock }) =>
  async (tenantId: string, sku: string, qty: number) => { /* uses deps.inventory, ... */ };
```

## The composition root

If nothing constructs its own dependencies, *something* still has to call `new`. That place is the **composition root**: a single module, as close to the program's entry point as possible, where the whole object graph is assembled.

```ts
// src/main/container.ts: the ONLY file that knows about every concrete class
import { PrismaClient } from "@prisma/client";
import { PrismaInventoryRepository } from "@/modules/inventory/infrastructure/prisma-inventory-repository";
import { PrismaPurchaseOrderDrafts } from "@/modules/purchasing/infrastructure/prisma-po-drafts";
import { SlackNotifier } from "@/modules/shared/infrastructure/slack-notifier";
import { ConsoleNotifier } from "@/modules/shared/infrastructure/console-notifier";
import { RecordShipment } from "@/modules/inventory/application/record-shipment";
import { config } from "./config";

const prisma = new PrismaClient();
const systemClock = { now: () => new Date() };

const inventoryRepo = new PrismaInventoryRepository(prisma);
const poDrafts = new PrismaPurchaseOrderDrafts(prisma);
const notifier = config.slackToken ? new SlackNotifier(config.slackToken) : new ConsoleNotifier();

export const container = {
  recordShipment: new RecordShipment(inventoryRepo, poDrafts, notifier, systemClock),
  // ...other use cases
};
```

```
                 +----------------------------+
                 |  main/container.ts         |   knows everything,
                 |  (composition root)        |   contains no business logic
                 +-------------+--------------+
                               | new + wire
        +----------------------+-----------------------+
        v                      v                       v
  PrismaInventoryRepo     SlackNotifier          RecordShipment(...)
  (infrastructure)        (infrastructure)       (application: knows only ports)
```

Rules for the composition root:

- **It's the only place** that imports concrete infrastructure *and* application classes together.
- **It contains no business logic**, only wiring and configuration choices ("Slack token present? Use Slack, otherwise log to the console").
- **Swapping an implementation is a one-line change here.** This is exactly what the Phase 1 capstone asks for: switching Postgres to MongoDB by changing configuration.

In Next.js, route handlers and server actions import from `container.ts`. In Express, `server.ts` builds the container and passes use cases into router factories. In a worker process, the worker entry file builds its own container, which can reuse the same factory functions.

### Lifetimes

Think about how long each object should live:

- **Singleton** (one per process): DB pool, HTTP clients, stateless repositories and use cases.
- **Scoped** (one per request): anything holding the current user, tenant or transaction. You'll often build a small per-request container: `makeRequestScope({ tenantId, tx })`.
- **Transient** (new every time): cheap value-like helpers.

A common bug in multi-tenant apps is putting `tenantId` on a singleton service, so that tenant A's request briefly sees tenant B's ID under concurrency. Tenant context belongs in method arguments or a request scope, never in a singleton's fields.

## DI without frameworks vs. DI containers

| | Manual ("pure DI") | Container (NestJS, InversifyJS, tsyringe, Awilix) |
|---|---|---|
| Setup | A plain TS file | Decorators/metadata, registration API |
| Type safety | Full. The compiler checks every `new` | Often token- or string-based, so errors appear at runtime |
| Learning curve | None | Framework-specific |
| Scales to | Hundreds of services comfortably | Very large graphs, auto-wiring, scopes |
| Debuggability | Go-to-definition works | Indirection through the container |

For most TypeScript SaaS apps, **manual DI in one composition root is enough and is the most transparent option.** Use NestJS's container if you're already on NestJS. It's well designed, and the providers/modules system maps cleanly onto the layering from lesson 1.

## Testing: where DI pays off

With injected ports, a unit test needs no mocking library, database or network:

```ts
class InMemoryInventory implements InventoryRepository {
  items = new Map<string, InventoryItem>();
  async getBySku(_t: string, sku: string) { return this.items.get(sku)!; }
  async save(item: InventoryItem) { this.items.set(item.sku, item); }
}
class FakeNotifier implements Notifier {
  sent: string[] = [];
  async notifyPurchasing(_t: string, msg: string) { this.sent.push(msg); }
}
const fixedClock: Clock = { now: () => new Date("2026-03-01T10:00:00Z") };

test("creates a PO draft and notifies when stock drops below reorder point", async () => {
  const inventory = new InMemoryInventory();
  inventory.items.set("SKU-1", InventoryItem.create({ sku: "SKU-1", onHand: 12, reorderPoint: 10, reorderQty: 50 }));
  const drafts = { created: [] as string[], async createDraft(_t: string, sku: string) { this.created.push(sku); return "PO-1"; } };
  const notifier = new FakeNotifier();

  await new RecordShipment(inventory, drafts, notifier, fixedClock).execute("t1", "SKU-1", 5);

  expect(drafts.created).toEqual(["SKU-1"]);
  expect(notifier.sent[0]).toContain("PO-1");
});
```

This test runs in milliseconds, never flakes, and documents the business rule. Compare that with `jest.mock("@/lib/db")` plus a hand-built chain of mocked Prisma methods.

**Fakes vs. mocks:** prefer simple hand-written *fakes* (working in-memory implementations) for repositories, and use *spies* for checking calls such as "the notifier was called." Fakes that implement the real interface are checked by the compiler. A mocked module isn't.

Injecting a `Clock` (and an `IdGenerator`) is a small habit with a big payoff. Anything time-based, like due dates, trial expiry or subscription renewals, becomes deterministic to test.

## Common mistakes

- **Service locator disguised as DI.** Passing the whole `container` into a class (`constructor(private c: Container)`) and calling `c.get(...)` inside hides the real dependencies again. Inject the specific things.
- **Injecting concrete classes.** `constructor(private repo: PrismaInventoryRepository)` is injection, but not inversion. Tests still need Prisma. Type parameters against the port.
- **Wiring scattered everywhere.** `new PrismaClient()` in twelve files means twelve connection pools and no single place to swap anything. There should be one composition root per process.
- **Constructor bloat ignored.** Eight dependencies means the class has too many jobs. Split the use case. Don't hide the problem with a container.
- **Request state in singletons.** Tenant ID, current user or an open transaction stored on a long-lived service causes cross-request leaks.
- **Mocking what you don't own.** Mocking the Stripe SDK's method chain in tests couples tests to the SDK's shape. Mock your own `PaymentCollector` port, and cover the Stripe adapter with a few integration tests.

## In the real world

- **NestJS** (`@Injectable()`, providers, modules), **Angular**, **Spring** (Java) and **ASP.NET Core** are all built on DI containers. If you move to an enterprise stack, constructor injection is the norm.
- **Next.js / Express shops** usually use a hand-written `container.ts` or a small library like Awilix. The concepts carry over directly.
- **Feature flags and gradual migrations** go through the composition root: `config.useNewTaxEngine ? new AvalaraTax() : new LegacyTax()`.
- **Interviews:** "How do you make code that calls Stripe testable?" or "What's the difference between DI and DIP?" Good answer: DIP is the design principle (depend on abstractions owned by policy), and DI is the mechanism (pass implementations in from outside, assembled at a composition root).

## Try it

1. Find a function in your codebase that imports `db`, `prisma`, `stripe` or `fetch` directly *and* contains a business decision.
2. Extract the decision into a class or factory that receives its dependencies through the constructor, typed as interfaces you define.
3. Create `container.ts` and wire the real implementations there. Update the route or job to use it.
4. Write two unit tests with hand-written fakes, including a fixed `Clock` if time matters.
5. Bonus: add a `ConsoleNotifier` and switch to it in the composition root when an env var is missing. Confirm that no other file changed.
