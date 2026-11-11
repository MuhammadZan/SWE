## Scenario

Your ERP has three flows that "work fine in testing" and misbehave in production a few times a month:

1. **Stock adjustment**: a warehouse app reads `on_hand`, subtracts the picked quantity in TypeScript, and writes the result back. Inventory counts drift.
2. **Expense approvals**: a department has a monthly budget. A manager can approve an expense if the sum of already-approved expenses plus this one stays within budget. Twice this quarter, two managers approved at the same moment and the department went over budget.
3. **Order allocation**: an order reserves stock line by line in the order the customer added items. Under month-end load, the logs show `deadlock detected` errors.

You suspect concurrency bugs, but "it happens sometimes" is not evidence. Your job is to build a lab that reproduces each anomaly **deterministically** with two real Postgres sessions, then prove each fix with the same harness.

## Starting point

Run Postgres 16+ in Docker. Lower the deadlock timeout so tests run fast:

```yaml
# docker-compose.yml
services:
  db:
    image: postgres:17
    environment:
      POSTGRES_PASSWORD: postgres
    ports: ["5433:5432"]
    command: ["postgres", "-c", "deadlock_timeout=100ms"]
```

Schema:

```sql
CREATE TABLE stock (
  product_id int PRIMARY KEY,
  on_hand    int NOT NULL CHECK (on_hand >= 0)
);

CREATE TABLE budgets (
  dept_id     int PRIMARY KEY,
  limit_cents bigint NOT NULL
);

CREATE TABLE expenses (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dept_id     int NOT NULL REFERENCES budgets(dept_id),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  status      text NOT NULL CHECK (status IN ('pending','approved'))
);
```

The key to determinism is that **you** control the interleaving. Each session is its own `pg.Client` (not a pool), and the test awaits each step in a fixed order. A statement that is expected to block is started without `await`, and the test then waits until Postgres reports that session as waiting on a lock before continuing:

```ts
import { Client } from "pg";

export async function session(): Promise<Client> {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  return c;
}

export async function pid(c: Client): Promise<number> {
  const { rows } = await c.query("SELECT pg_backend_pid() AS pid");
  return rows[0].pid;
}

// Poll from a third connection until `pid` is blocked on a lock.
export async function waitUntilBlocked(observer: Client, targetPid: number, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { rows } = await observer.query(
      "SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1",
      [targetPid],
    );
    if (rows[0]?.wait_event_type === "Lock") return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`pid ${targetPid} never blocked`);
}
```

Never use `setTimeout` alone to "give the other session time". Tests that rely on sleeps pass on your laptop and fail in CI.

## What to build

A TypeScript project (Vitest or `node:test`) with one test file per anomaly. Each file contains a **bug** test that asserts the wrong outcome happens, and a **fix** test that asserts the right outcome under the identical interleaving.

### 1. Lost update

- **Bug**: at `READ COMMITTED`, sessions A and B both read `on_hand = 10`, A writes `10 - 3`, commits, B writes `10 - 4`, commits. Assert final `on_hand = 6` (A's pick is lost).
- **Fix A**: atomic `UPDATE stock SET on_hand = on_hand - $2 WHERE product_id = $1 AND on_hand >= $2`. Assert final `3`.
- **Fix B**: `SELECT ... FOR UPDATE`. Show that B blocks (using `waitUntilBlocked`) until A commits, then reads 7. Assert final `3`.
- **Observation**: at `REPEATABLE READ`, the bug interleaving makes B fail with SQLSTATE `40001`. Assert the error code.

### 2. Write skew (budget)

Budget limit 1,000.00, already approved 700.00. Two managers each approve a pending 200.00 expense.

- **Bug**: at `REPEATABLE READ`, both sessions `SELECT sum(amount_cents) ... WHERE status = 'approved'`, both see 70000, both approve. Assert approved total `110000` (over budget) and that neither session raised an error.
- **Fix A**: `SERIALIZABLE` plus a retry helper. Assert one session gets `40001` on its first attempt, the retry re-reads the sum, rejects the approval, and the final approved total is `90000`.
- **Fix B**: materialize the conflict with `SELECT ... FROM budgets WHERE dept_id = $1 FOR UPDATE` at `READ COMMITTED`. Assert the second session blocks, then sees 90000 and rejects.
- In your README, explain why `FOR UPDATE` on the existing `expenses` rows would **not** fix this.

### 3. Deadlock

- **Bug**: session A updates product 1 then product 2; session B updates product 2 then product 1, interleaved so each holds one lock. Assert exactly one session fails with SQLSTATE `40P01` and the other commits.
- **Fix**: an `allocate(lines)` function that sorts lines by `product_id` (or locks all rows with one `SELECT ... WHERE product_id = ANY($1) ORDER BY product_id FOR UPDATE`) before updating. Run the same two orders with the same opposing input order and assert both commit with no error, and final stock is correct.

### 4. A reusable retry helper

`withTx(client, isolation, fn, { maxAttempts })` that retries on `40001` and `40P01` with jittered backoff, re-running the whole function. Unit-test that it retries the right codes, does not retry `23505`, and gives up after `maxAttempts`.

## Constraints

- Real Postgres only. No mocks of the database for these tests.
- No sleeps to control ordering; use awaited steps and lock-wait polling.
- Every test resets the tables to a known state before it runs.
- Each test file must run in under 5 seconds.

## How to measure and verify

- Run the full suite 20 times in a row (`for i in $(seq 20); do npx vitest run || break; done`). All 20 runs pass. Flaky tests mean your interleaving is not actually controlled.
- Each bug test must fail if you apply the fix to it (try it once to confirm the test is meaningful).
- Your README contains, for each anomaly, the two-session timeline as an ASCII table and the SQLSTATE observed.
