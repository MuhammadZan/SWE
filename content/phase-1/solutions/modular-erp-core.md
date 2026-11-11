## What a strong solution looks like

A strong capstone has a domain that would survive being printed on paper. `Money` is integer minor units plus a currency with explicit half-even rounding. `Invoice` enforces its own status transitions and refuses line changes after draft. `StockItem` refuses reservations beyond `onHand - reserved`. Use cases orchestrate through ports only: repositories per aggregate, a `UnitOfWork` that hands out transaction-bound repositories, an `InvoiceNumberSequence`, a `Clock` and an `IdGenerator`.

Two complete adapter sets sit at the edge, and `container.ts` is the only file that reads `PERSISTENCE`. A dependency-cruiser or ESLint rule fails CI if `domain/` or `application/` imports `pg`, `mongodb` or `express`.

The test suite is where strong submissions separate themselves:

- **Use-case unit tests** with in-memory fakes, covering every use case's happy path and rule violations, finishing in well under two seconds.
- **One repository and Unit of Work contract suite**, written as a function over a factory, run against the in-memory fakes, Postgres and Mongo.
- **Atomicity, concurrency and tenant-isolation tests** that run against both real providers.

When everything is green, `PERSISTENCE=mongo npm run e2e` passes with no code change. That is the actual proof the boundaries are real.

## Reference approach

**Money and tax.** Rounding is a domain rule, so it lives in `Money`:

```ts
export class Money {
  private constructor(readonly minor: bigint, readonly currency: string) {}
  static of(minor: bigint, currency: string) { return new Money(minor, currency); }
  add(o: Money) { this.same(o); return new Money(this.minor + o.minor, this.currency); }
  times(qty: number) { return new Money(this.minor * BigInt(qty), this.currency); }
  // rate as basis points: 19% = 1900
  percent(bp: number): Money {
    const num = this.minor * BigInt(bp), den = 10_000n;
    const q = num / den, r = num % den;
    const twice = 2n * (r < 0n ? -r : r);
    const roundUp = twice > den || (twice === den && q % 2n !== 0n); // half-even
    return new Money(q + (roundUp ? (num < 0n ? -1n : 1n) : 0n), this.currency);
  }
  private same(o: Money) { if (o.currency !== this.currency) throw new DomainError("Currency mismatch"); }
}
```

Unit tests pin the edge cases: an exact half cent rounds to the even cent (50 cents at 5% is 2.5 cents and becomes 2; 70 cents at 5% is 3.5 cents and becomes 4), negative amounts round symmetrically for credit notes, and totals are computed as `subtotal + tax` once, not per line, unless you document otherwise.

**Unit of Work port and use case.**

```ts
export interface UnitOfWork {
  run<T>(work: (tx: TxRepos) => Promise<T>): Promise<T>;
}
export interface TxRepos {
  invoices: InvoiceRepository;
  stock: StockRepository;
  numbers: InvoiceNumberSequence;
}

export class IssueInvoice {
  constructor(private readonly uow: UnitOfWork, private readonly clock: Clock) {}
  execute(tenantId: TenantId, id: string) {
    return this.uow.run(async ({ invoices, stock, numbers }) => {
      const inv = await invoices.get(tenantId, id);
      for (const line of inv.lines) {
        const item = await stock.getForUpdate(tenantId, line.sku);
        item.shipReserved(line.qty);
        await stock.save(item);
      }
      const now = this.clock.now();
      inv.issue(await numbers.next(tenantId, now.getUTCFullYear()), now);
      await invoices.save(inv);
      return inv;
    });
  }
}
```

**Gap-free numbering.**

- **Postgres:** `UPDATE invoice_counters SET last = last + 1 WHERE tenant_id = $1 AND year = $2 RETURNING last`, inside the issuing transaction. The row lock serializes concurrent issues per tenant and year, and a rollback undoes the increment. (Insert the counter row with `ON CONFLICT DO NOTHING` first.) A Postgres sequence would leave gaps, because `nextval()` is not rolled back.
- **Mongo:** `findOneAndUpdate({ tenantId, year }, { $inc: { last: 1 } }, { upsert: true, returnDocument: "after", session })` inside the transaction.

**Mongo Unit of Work.** Use `session.withTransaction`, which retries on `TransientTransactionError`:

```ts
async run<T>(work: (tx: TxRepos) => Promise<T>) {
  const session = this.client.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await work(this.reposFor(session));
    });
    return result;
  } finally {
    await session.endSession();
  }
}
```

Because `withTransaction` may run the callback more than once, the work must not do non-transactional side effects such as sending email. The Postgres UoW should state the same rule.

**Contract suite**, shared by all three implementations:

```ts
export function stockContract(name: string, make: () => Promise<{ uow: UnitOfWork; seed: Seeder }>) {
  describe(`stock contract: ${name}`, () => {
    it("rejects a reservation beyond available", async () => { /* ... */ });
    it("does not return another tenant's stock item", async () => { /* ... */ });
    it("rolls back every change when work throws", async () => {
      const { uow, seed } = await make();
      await seed.stock("t1", "SKU-1", { onHand: 5 });
      await expect(uow.run(async ({ stock }) => {
        const s = await stock.getForUpdate("t1", "SKU-1");
        s.reserve(3);
        await stock.save(s);
        throw new Error("boom");
      })).rejects.toThrow("boom");
      const after = await uow.run(({ stock }) => stock.getForUpdate("t1", "SKU-1"));
      expect(after.reserved).toBe(0);
    });
  });
}
```

The in-memory UoW must also pass the rollback case. Snapshotting its maps before `work` and restoring them on throw takes about ten lines, and it keeps the fakes honest.

**Concurrency.** For reservations, either lock the stock row (`SELECT ... FOR UPDATE`) or use a conditional update (`UPDATE stock SET reserved = reserved + $q WHERE ... AND on_hand - reserved >= $q`) and treat zero affected rows as "insufficient stock". In Mongo, the equivalent is a filter with `$expr` on `onHand - reserved` combined with `$inc`, or relying on transaction write conflicts plus retries. The 20-parallel-requests test must show exactly 10 successes on both providers.

## Common mistakes

- **Floats sneaking back in** through `price * qty` in a mapper, or `Number(row.amount)` on a `numeric` column. Mappers must convert to and from minor units explicitly.
- **The Mongo adapter without transactions** (no replica set), so atomicity "works" in Postgres only.
- **Use cases branching on provider** (`if (config.persistence === "mongo")`), or a shared "BaseRepository" that leaks Mongo `ObjectId` or Prisma types into the domain.
- **Contract tests that cover only the happy path,** so tenant mismatch, not-found and rollback bugs in one adapter go unnoticed.
- **Fakes that don't roll back**, which means use-case tests that check partial-failure behavior pass against the fake and fail in production.
- **Numbering with `MAX(number) + 1`** or a Postgres sequence. Under concurrency this creates duplicates or gaps.
- **Side effects inside `uow.run`** (HTTP calls, emails) that are repeated when Mongo retries the transaction.

## Trade-offs worth discussing

- **Read side.** `InvoiceQueries` returning DTOs with provider-specific queries is pragmatic. Forcing lists through aggregates is pure but slow. An ADR should say which one you chose.
- **Lowest common denominator.** Supporting both providers rules out Postgres-only features (RLS, `EXCLUDE` constraints) in the core path. In real life you'd rarely need two providers; the exercise is about proving boundaries.
- **Pessimistic versus optimistic locking.** `FOR UPDATE` is simple and correct under contention. Version fields scale better when conflicts are rare, but need retry logic in callers.
- **Per-line versus per-invoice tax rounding.** Both are legal in different jurisdictions. Pick one, document it, and test it.
- **Test pyramid cost.** Contract and concurrency tests against two real databases are slow. Keep them in a separate integration project so `npm test` stays instant.

## Grade yourself

| Dimension | Strong | Acceptable | Needs work |
|---|---|---|---|
| Boundaries | CI fails on forbidden imports; deleting `infrastructure/mongo/` breaks only `container.ts` | Clean by inspection, lint script exists but isn't in CI | Domain or use cases import a DB or HTTP package |
| Domain correctness | Money in minor units with tested half-even edge cases; transitions and reservation rules enforced in entities | Rules correct but some enforced in use cases | Float money, or rules in adapters/handlers |
| Use-case tests | Every use case tested with in-memory fakes, including rule violations, under 2 s total | Main use cases tested, some gaps | Use-case tests need a database, or none |
| Contract suite | One factory-based suite with edge cases (not found, tenant mismatch, rollback) passing on in-memory, Postgres and Mongo | Suite passes on both databases, happy paths only | Separate, divergent tests per adapter |
| Atomicity and concurrency | Forced-failure and 20-parallel tests pass on both providers; numbering gap-free under load | Atomicity proven on both, concurrency on one | Not tested, or Mongo without transactions |
| The swap and docs | `PERSISTENCE=mongo` e2e passes with zero diffs; diagram, README and ADR explain it in 10 minutes | Swap works, documentation thin | Swap requires code edits |

## Going further

1. Add a transactional outbox: `IssueInvoice` writes an `InvoiceIssued` record in the same transaction, and a worker with its own composition root publishes it.
2. Add optimistic locking with a `version` field and a contract test that proves a stale write is rejected on all implementations.
3. Add a third adapter (SQLite or an event-sourced store) and see whether the contract suite catches every behavioral difference on the first run.
