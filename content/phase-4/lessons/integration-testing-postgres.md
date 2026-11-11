## Why this matters

Your unit tests are green. Your in-memory fake repository returns invoices perfectly. Then production throws `duplicate key value violates unique constraint "invoices_number_key"` because two concurrent requests generated the same invoice number, and your fake never enforced uniqueness. Or a migration renamed `customer_id` to `account_id` and every query in the repository is now broken, while every unit test still passes because they never touch SQL.

Unit tests prove your logic is right *given its inputs*. Integration tests prove the pieces actually connect: your SQL against the real Postgres version, your constraints, your transactions, your HTTP layer serialising responses, your migrations applying cleanly. For a SaaS or ERP backend, most of the bugs that wake people up live in exactly those seams.

## What counts as an integration test

An integration test exercises your code together with at least one real dependency that you would otherwise fake. In practice for a Node/Postgres backend this means:

- Repository tests: real queries against a real Postgres with your real schema.
- Service tests: business logic plus repository plus a real database, with only third-party HTTP APIs (Stripe, tax providers, email) replaced.
- HTTP route tests: send a request into your app (in-process, no real network port required) and assert on status codes, bodies, and database state.

The key word is *real*. SQLite is not Postgres. It has different types, different locking, no `jsonb`, no `ON CONFLICT ... DO UPDATE` in the same shape, and different behaviour for case-sensitive comparisons. Testing against a different engine than production gives you false confidence.

## The test pyramid and the testing trophy

```
     Test pyramid (Cohn)              Testing trophy (Dodds)

           /\                                 ___
          /E2E\                              |E2E|
         /------\                         ___|___|___
        /  Integ \                       |Integration|  <- most effort here
       /----------\                      |___________|
      /    Unit    \                        | Unit |
     /--------------\                       |______|
                                          __|Static|__
                                         |_types/lint_|
```

The pyramid says: many fast unit tests, fewer integration tests, very few end-to-end tests, because higher levels are slower and flakier. The trophy argues that for typical web apps, integration tests give the best confidence per minute of effort, and that static analysis (TypeScript, ESLint) is the cheapest layer of all.

Neither is a law. Decide by asking where your bugs actually come from:

| Code area | Where bugs hide | Best test level |
|---|---|---|
| Pricing, tax, proration rules | Arithmetic, branching | Unit |
| Repositories, reporting queries | SQL, constraints, indexes, nulls | Integration with real DB |
| API routes | Validation, auth, status codes, serialisation | Integration (in-process HTTP) |
| Checkout flow across UI and backend | Wiring, browser behaviour | A handful of E2E tests |

A sensible SaaS split: a dense layer of unit tests on the money and rules code, solid integration tests for every repository and every route, and a small set of end-to-end smoke tests for the flows that make you money (sign-up, upgrade, pay invoice).

## Getting a real Postgres: two options

### Option A: Testcontainers

Testcontainers starts a throwaway Docker container from your test code and gives you its connection details. Each test run gets a clean database with the same Postgres major version as production.

```bash
npm install -D @testcontainers/postgresql
npm install pg
```

```ts
// test/global-setup.ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { runMigrations } from "../src/db/migrate";

let container: StartedPostgreSqlContainer;

export async function setup() {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  process.env.DATABASE_URL = container.getConnectionUri();
  await runMigrations(process.env.DATABASE_URL);
}

export async function teardown() {
  await container?.stop();
}
```

```ts
// vitest.integration.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.int.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // DB tests share one database; run files sequentially to avoid cross-talk
    fileParallelism: false,
  },
});
```

Pros: zero manual setup, works on any machine with Docker, version pinned in code. Cons: needs Docker available (fine on GitHub Actions Ubuntu runners), adds a few seconds of startup.

### Option B: docker compose

If your team already runs Postgres through compose for local development, add a dedicated test database:

```yaml
# compose.test.yaml
services:
  db-test:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app_test
    ports:
      - "55432:5432"
    tmpfs:
      - /var/lib/postgresql/data # in-memory, fast, wiped on stop
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app_test"]
      interval: 2s
      timeout: 2s
      retries: 20
```

```bash
docker compose -f compose.test.yaml up -d --wait
DATABASE_URL=postgres://app:app@localhost:55432/app_test npm run test:int
```

`--wait` blocks until the healthcheck passes, which avoids the classic "connection refused" flake on the first test. In CI you will use GitHub Actions service containers instead, covered in the CI lesson.

## Test data

Integration tests need rows. How you create them determines whether the suite stays maintainable.

**Avoid a giant shared seed file.** Every test ends up depending on "customer 7 has two overdue invoices", and nobody dares to change the seed.

**Use small factories** that create exactly what each test needs, with sensible defaults you override:

```ts
// test/factories.ts
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";

type Db = Pool | PoolClient;

export async function createCustomer(db: Db, overrides: Partial<{ name: string; country: string; tier: string }> = {}) {
  const row = { id: randomUUID(), name: "Acme GmbH", country: "DE", tier: "growth", ...overrides };
  await db.query("insert into customers (id, name, country, tier) values ($1, $2, $3, $4)", [
    row.id, row.name, row.country, row.tier,
  ]);
  return row;
}

type InvoiceOverrides = Partial<{ number: string; totalCents: number; status: string; dueDate: string }>;

export async function createInvoice(db: Db, customerId: string, overrides: InvoiceOverrides = {}) {
  const row = {
    id: randomUUID(),
    number: `INV-${randomUUID().slice(0, 8)}`,
    totalCents: 10_000,
    status: "draft",
    dueDate: "2026-01-31",
    ...overrides,
  };
  await db.query(
    "insert into invoices (id, customer_id, number, total_cents, status, due_date) values ($1, $2, $3, $4, $5, $6)",
    [row.id, customerId, row.number, row.totalCents, row.status, row.dueDate],
  );
  return row;
}
```

Random IDs and invoice numbers mean tests never collide on unique constraints by accident. A test that *wants* a collision passes the number explicitly.

## Isolation: each test starts clean

Tests that leak data into each other pass alone and fail together, or fail only in CI where order differs. Three common strategies:

| Strategy | How | Speed | Caveat |
|---|---|---|---|
| Transaction rollback | Open a transaction before each test, roll back after | Fastest | Code under test must use the same connection; cannot test commit behaviour |
| Truncate tables | `TRUNCATE ... RESTART IDENTITY CASCADE` before each test | Fast | Must list tables; sequential execution |
| Database per worker | Create `app_test_1`, `app_test_2` from a template | Fast and parallel | More setup |

Transaction rollback with `pg`:

```ts
// test/db.ts
import { Pool, type PoolClient } from "pg";
import { beforeEach, afterEach, afterAll } from "vitest";

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export function useTransactionalDb() {
  const ctx = {} as { client: PoolClient };
  beforeEach(async () => {
    ctx.client = await pool.connect();
    await ctx.client.query("begin");
  });
  afterEach(async () => {
    await ctx.client.query("rollback");
    ctx.client.release();
  });
  afterAll(() => pool.end());
  return ctx;
}
```

For this to work, your repository must accept a connection (`Pool` or `PoolClient`) rather than importing a global pool. That is the dependency injection from Phase 1 paying off.

## Testing a repository against real SQL

```ts
// src/billing/invoice-repo.int.test.ts
import { describe, it, expect } from "vitest";
import { useTransactionalDb } from "../../test/db";
import { createCustomer, createInvoice } from "../../test/factories";
import { InvoiceRepository } from "./invoice-repo";

describe("InvoiceRepository", () => {
  const db = useTransactionalDb();

  it("lists overdue invoices for a customer, oldest due date first", async () => {
    const c = await createCustomer(db.client);
    await createInvoice(db.client, c.id, { status: "overdue", number: "INV-2", dueDate: "2026-03-01" });
    await createInvoice(db.client, c.id, { status: "paid", number: "INV-3", dueDate: "2026-01-01" });
    await createInvoice(db.client, c.id, { status: "overdue", number: "INV-1", dueDate: "2026-02-01" });

    const repo = new InvoiceRepository(db.client);
    const result = await repo.listOverdue(c.id);

    expect(result.map((i) => i.number)).toEqual(["INV-1", "INV-2"]);
  });

  it("enforces unique invoice numbers", async () => {
    const c = await createCustomer(db.client);
    await createInvoice(db.client, c.id, { number: "INV-100" });

    await expect(createInvoice(db.client, c.id, { number: "INV-100" })).rejects.toMatchObject({
      code: "23505", // Postgres unique_violation
    });
  });
});
```

Ordering is driven by an explicit `dueDate`, not `created_at`: inside a single transaction `now()` returns the same timestamp for every row, so ordering by insertion time would be nondeterministic. The second test checks the database constraint itself. An in-memory fake could never give you that. Note: once a statement fails inside a Postgres transaction, the transaction is aborted. Keep "expected failure" assertions as the last statement in a test, or wrap them in a `savepoint`.

## Testing HTTP routes in-process

You do not need to start a real server on a port. With Express or Fastify you can inject requests directly.

```ts
// src/http/app.ts (Fastify)
import Fastify from "fastify";
import type { Pool } from "pg";
import { InvoiceRepository } from "../billing/invoice-repo";

export function buildApp(deps: { db: Pool }) {
  const app = Fastify();
  app.get<{ Params: { id: string } }>("/customers/:id/invoices/overdue", async (req, reply) => {
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return reply.code(400).send({ error: "invalid id" });
    const rows = await new InvoiceRepository(deps.db).listOverdue(req.params.id);
    return { data: rows };
  });
  return app;
}
```

```ts
// src/http/app.int.test.ts
import { describe, it, expect, afterAll } from "vitest";
import { Pool } from "pg";
import { buildApp } from "./app";
import { createCustomer, createInvoice } from "../../test/factories";

const db = new Pool({ connectionString: process.env.DATABASE_URL });
const app = buildApp({ db });
afterAll(async () => { await app.close(); await db.end(); });

describe("GET /customers/:id/invoices/overdue", () => {
  it("returns 400 for a malformed id", async () => {
    const res = await app.inject({ method: "GET", url: "/customers/not-a-uuid/invoices/overdue" });
    expect(res.statusCode).toBe(400);
  });

  it("returns only overdue invoices", async () => {
    const c = await createCustomer(db);
    await createInvoice(db, c.id, { status: "overdue" });
    await createInvoice(db, c.id, { status: "paid" });

    const res = await app.inject({ method: "GET", url: `/customers/${c.id}/invoices/overdue` });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });
});
```

Here the route uses a pool, not a single transaction, so isolate by creating a fresh customer per test and only asserting on that customer's data, or truncate in `beforeEach`. For Express, `supertest` gives the same in-process style: `await request(app).get("/...")`.

## What to replace and what to keep real

```
  +-----------------------------------------------------+
  |  Your process                                       |
  |   HTTP route -> service -> repository -> pg driver  |---> REAL Postgres (container)
  |                    |                                |
  |                    +-> StripeClient   (fake/stub)   |-x-> no real network
  |                    +-> TaxApiClient   (stub)        |-x->
  |                    +-> Mailer         (spy)         |-x->
  +-----------------------------------------------------+
```

Keep real anything you own and deploy alongside your app (database, Redis, queue). Replace third-party APIs you cannot control; test those contracts separately with recorded responses or the provider's sandbox in a dedicated, non-blocking job.

## Common mistakes

- **Using SQLite or an in-memory DB "because it's faster".** You are now testing a different database.
- **Not running migrations in test setup.** The test schema drifts from production and tests pass on a schema that does not exist.
- **Shared mutable seed data.** Tests become order-dependent; one new test breaks five old ones.
- **Sleeping instead of waiting for readiness.** `sleep 5` before tests is flaky; use healthchecks and `--wait`, or Testcontainers' built-in wait strategy.
- **Parallel test files hitting the same tables** without isolation. Pick a strategy from the table above and enforce it.
- **Mocking the database in "integration" tests.** That is a unit test with a misleading filename.
- **Asserting on full response bodies with timestamps and UUIDs.** Assert on the fields that matter or use `expect.any(String)`.

## In the real world

Most mature Node backends split commands: `npm test` runs unit tests in seconds for the inner loop, `npm run test:int` runs integration tests against a container and takes a minute or two. CI runs both on every pull request. Teams with large suites create one database per Vitest worker from a migrated template (`CREATE DATABASE app_test_3 TEMPLATE app_template`), which takes milliseconds and allows full parallelism.

A common incident pattern: a migration adds a `NOT NULL` column without a default, local tests pass because the developer's database was recreated, and production fails because existing rows violate the constraint. Integration tests that run migrations from scratch and then against a snapshot with representative data catch this class of bug.

## Try it

1. Add Testcontainers to a project with an `invoices` table. Write `global-setup.ts` that starts `postgres:16-alpine` and runs your migrations.
2. Write factories for `customers` and `invoices`.
3. Write three repository tests: a filtered list, a unique constraint violation (assert on code `23505`), and an aggregate query (total outstanding per customer).
4. Write two route tests with `app.inject` or `supertest`: one 400 validation failure, one 200 that checks database-backed content.
5. Run the suite twice in a row and in a different file order (`vitest --sequence.shuffle`). It must pass every time.
