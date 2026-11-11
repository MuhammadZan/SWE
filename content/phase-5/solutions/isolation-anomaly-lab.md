## What a strong solution looks like

A strong submission reads like a lab notebook with proof. There is a tiny harness (sessions, `pid`, `waitUntilBlocked`, a `reset()` that truncates and reseeds), and each anomaly has a bug test and a fix test that use the **same** step sequence, so the only variable is the technique. Every assertion is about an observable outcome: a final row value, an approved total, or a specific SQLSTATE on a specific session. Nothing sleeps to control order. The suite passes 20 runs out of 20, in CI as well as locally.

The README is the other half: a two-session timeline per anomaly, the error observed, and a sentence on *why* the fix works in terms of snapshots and locks, not "because SERIALIZABLE is safer". The strongest submissions explicitly explain why `FOR UPDATE` on existing expense rows cannot protect a sum that a concurrent insert or status change can alter, and why materializing the conflict on the `budgets` row can.

## Reference approach

### Driving the interleaving

Each session is a dedicated `Client`. A blocking statement is started without `await`, the test confirms it is waiting on a lock, then releases the blocker:

```ts
it("FOR UPDATE serializes the read-modify-write", async () => {
  const [a, b, obs] = await Promise.all([session(), session(), session()]);
  const bPid = await pid(b);

  await a.query("BEGIN");
  await b.query("BEGIN");
  const aRow = await a.query("SELECT on_hand FROM stock WHERE product_id = 1 FOR UPDATE");

  const bRead = b.query("SELECT on_hand FROM stock WHERE product_id = 1 FOR UPDATE"); // no await
  await waitUntilBlocked(obs, bPid);

  await a.query("UPDATE stock SET on_hand = $1 WHERE product_id = 1", [aRow.rows[0].on_hand - 3]);
  await a.query("COMMIT");

  const bRow = await bRead;                       // unblocks, sees 7
  expect(bRow.rows[0].on_hand).toBe(7);
  await b.query("UPDATE stock SET on_hand = $1 WHERE product_id = 1", [bRow.rows[0].on_hand - 4]);
  await b.query("COMMIT");

  expect(await onHand(obs, 1)).toBe(3);
});
```

The Repeatable Read observation uses the bug sequence with `BEGIN ISOLATION LEVEL REPEATABLE READ` and asserts `await expect(b.query(update)).rejects.toMatchObject({ code: "40001" })`. B's snapshot was taken at its first `SELECT`, before A committed, so its update targets a row version that is no longer current.

### Write skew

The bug: both sessions run `SELECT coalesce(sum(amount_cents),0) FROM expenses WHERE dept_id = 1 AND status = 'approved'` (70000), each checks `70000 + 20000 <= 100000`, each updates a *different* pending expense to `approved`, both commit. No row is written twice, so no lock conflict exists, and Repeatable Read commits both: 110000.

Serializable fix: same steps at `SERIALIZABLE`. SSI sees that each transaction wrote something the other read (a cycle of read/write dependencies) and aborts one. Depending on the exact moment the dangerous structure is detected, the `40001` arrives on the second `UPDATE` or on `COMMIT`; a robust test asserts "exactly one of the two sessions saw 40001 somewhere" rather than pinning the statement. The retry then runs the whole body again in a fresh transaction, reads 90000, and rejects:

```ts
const RETRYABLE = new Set(["40001", "40P01"]);

export async function withTx<T>(
  c: Client,
  isolation: "READ COMMITTED" | "REPEATABLE READ" | "SERIALIZABLE",
  fn: (c: Client) => Promise<T>,
  { maxAttempts = 5, baseMs = 5 } = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      await c.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      const out = await fn(c);
      await c.query("COMMIT");
      return out;
    } catch (e: any) {
      await c.query("ROLLBACK").catch(() => {});
      if (!RETRYABLE.has(e.code) || attempt >= maxAttempts) throw e;
      await new Promise((r) => setTimeout(r, Math.random() * baseMs * 2 ** attempt));
    }
  }
}
```

(The jittered sleep is fine here: it is backoff, not ordering control.)

Materialized-conflict fix at Read Committed:

```sql
BEGIN;
SELECT limit_cents FROM budgets WHERE dept_id = $1 FOR UPDATE;   -- the shared choke point
SELECT coalesce(sum(amount_cents), 0) FROM expenses
 WHERE dept_id = $1 AND status = 'approved';                      -- fresh snapshot per statement
UPDATE expenses SET status = 'approved' WHERE id = $2;            -- only if within budget
COMMIT;
```

Session B blocks on the budget row; when A commits, B's next statement takes a new snapshot (Read Committed) and sees 90000. Note this relies on Read Committed's per-statement snapshot. At Repeatable Read the lock alone is **not** enough: B's snapshot was taken when its first statement started (before A committed), A only locked the budget row without modifying it, so B acquires the lock, still sums 70000, and over-approves. It becomes safe again at Repeatable Read only if A also *updates* the budget row (for example maintaining an `approved_cents` counter), in which case B's `FOR UPDATE` fails with `40001`. Strong READMEs mention this subtlety, ideally with a test that demonstrates it.

### Deadlock

Bug: A updates 1, B updates 2, A updates 2 (start, `waitUntilBlocked`), B updates 1. After `deadlock_timeout` (100 ms in the compose file), one session gets `40P01`. Use `Promise.allSettled` on both pending statements and assert exactly one rejected with that code.

Fix:

```ts
export async function allocate(c: Client, lines: { productId: number; qty: number }[]) {
  const sorted = [...lines].sort((x, y) => x.productId - y.productId);
  await c.query(
    "SELECT product_id FROM stock WHERE product_id = ANY($1) ORDER BY product_id FOR UPDATE",
    [sorted.map((l) => l.productId)],
  );
  for (const l of sorted) {
    const r = await c.query(
      "UPDATE stock SET on_hand = on_hand - $2 WHERE product_id = $1 AND on_hand >= $2",
      [l.productId, l.qty],
    );
    if (r.rowCount === 0) throw new InsufficientStockError(l.productId);
  }
}
```

Both sessions now request locks in the same order, so the second simply waits for the first; there is no cycle.

## Common mistakes

- **Sleeping to order steps.** `await sleep(50)` instead of `waitUntilBlocked`. It passes locally and fails on a loaded CI runner.
- **Using a pool for sessions.** Two `pool.query` calls may run on the same connection, or `BEGIN` and the next statement may run on different connections. Each session must be one dedicated client.
- **Bug tests that do not prove the bug.** Asserting only "no error" rather than the wrong final value. Apply the fix inside the bug test once; if it still passes, it was not testing anything.
- **Retrying only the failed statement** instead of the whole transaction, which re-applies a decision made on stale data.
- **Pinning the 40001 to one exact statement** in the serializable test. SSI may report it on the write or on the commit.
- **Forgetting cleanup.** A test that fails mid-transaction leaves a session holding locks, and every later test hangs. Close clients in `afterEach`.

## Trade-offs worth discussing

- **Atomic update vs `FOR UPDATE`**: the atomic statement is shorter and holds the lock for microseconds, but only works when the decision fits in one SQL expression. `FOR UPDATE` allows arbitrary TypeScript logic between read and write, at the cost of a longer lock.
- **Serializable vs materialized conflict**: Serializable protects invariants you have not thought of yet, but every caller must retry, and false-positive aborts rise with concurrency and with sequential scans (coarser predicate locks). Locking the budget row is explicit, cheap and never aborts, but only protects the invariant you remembered to guard.
- **Lock ordering vs retry on 40P01**: ordering prevents deadlocks you know about; retry handles the ones you do not. Production code wants both.
- **`deadlock_timeout`**: lowering it detects deadlocks faster but runs the (expensive) detector more often on ordinary lock waits. 100 ms is for tests; production usually keeps 1 s.

## Grade yourself

| Dimension | Strong | Acceptable | Needs work |
|---|---|---|---|
| Determinism | 20/20 runs pass; ordering via awaited steps and lock-wait polling only | Passes reliably locally, one sleep remains | Flaky, or uses sleeps to order steps |
| Bug reproduction | Each bug test asserts the specific wrong value or error, and fails when the fix is applied | Bug tests assert the wrong outcome but were never validated against the fix | Bug tests only assert "no error" |
| Fix coverage | Lost update (atomic + FOR UPDATE), write skew (SERIALIZABLE + retry and budget lock), deadlock (ordering) all proven | Each anomaly has one working fix | A fix is missing or only described |
| Retry helper | Retries whole body on 40001/40P01 with jitter, capped, unit-tested including non-retryable codes | Retries but untested or retries everything | No retry around SERIALIZABLE |
| Explanation | README timelines plus a correct explanation of snapshots, why FOR UPDATE on expenses fails, and the RC vs RR subtlety of the budget lock | Timelines present, explanations generic | No timelines |
| Hygiene | Reset per test, clients closed in afterEach, files under 5 s | Mostly clean | Tests depend on each other's state |

## Going further

- Add an optimistic-locking variant (a `version` column with `UPDATE ... WHERE version = $n`) for the stock case and compare the number of retries under 50 concurrent sessions against `FOR UPDATE`.
- Turn the expense flow into an HTTP endpoint and run a k6 test with 100 concurrent approvals; record how many `40001` retries happen at Serializable and the p95 latency cost.
- Reproduce the same lost-update scenario on MySQL 8 (InnoDB, default Repeatable Read) and document how its behaviour differs from Postgres.
