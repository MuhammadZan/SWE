## Scenario

You've joined a small B2B SaaS team as the engineer responsible for the accounts module. The "create user" endpoint has grown over two years. It validates input, checks seat limits against the tenant's subscription, normalizes emails, hashes passwords, writes to Postgres and returns the row. Every change to it breaks something, and nobody has written a test because "you'd need a database."

Your job is **The Separation**: split this handler so that all data access lives in a dedicated `UserRepository`, the business decisions live in a use case, and the route handler only translates HTTP.

## Starting point

Create a fresh Node + TypeScript project (Express, Fastify, Hono or a Next.js route handler all work) and paste in this handler as your "legacy" starting point. Use Prisma, Drizzle, Knex or `pg`, whichever you prefer.

```ts
// routes/users.ts: the legacy handler
app.post("/tenants/:tenantId/users", async (req, res) => {
  const { tenantId } = req.params;
  const { email, name, password, role } = req.body;

  if (!email || !email.includes("@")) return res.status(400).json({ error: "Invalid email" });
  if (!password || password.length < 10) return res.status(400).json({ error: "Weak password" });

  const normalized = email.trim().toLowerCase();
  const dup = await db.query(
    "SELECT id FROM users WHERE tenant_id = $1 AND email = $2 AND deleted_at IS NULL",
    [tenantId, normalized],
  );
  if (dup.rowCount) return res.status(409).json({ error: "Email already in use" });

  const { rows: [sub] } = await db.query(
    "SELECT p.seat_limit FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.tenant_id = $1",
    [tenantId],
  );
  const { rows: [{ count }] } = await db.query(
    "SELECT COUNT(*)::int AS count FROM users WHERE tenant_id = $1 AND deleted_at IS NULL",
    [tenantId],
  );
  if (count >= sub.seat_limit) return res.status(402).json({ error: "Seat limit reached" });

  const hash = await bcrypt.hash(password, 12);
  const { rows: [user] } = await db.query(
    "INSERT INTO users (id, tenant_id, email, name, role, password_hash, created_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now()) RETURNING *",
    [tenantId, normalized, name, role ?? "member", hash],
  );
  res.status(201).json(user);
});
```

The schema you need: `tenants`, `plans(id, seat_limit)`, `subscriptions(tenant_id, plan_id)` and `users(id, tenant_id, email, name, role, password_hash, created_at, deleted_at)`. Write a migration or SQL file and a small seed.

Before refactoring, write down every responsibility this handler has. You should find at least seven.

## What to build

1. **A `User` domain type** (class or type plus factory) and an `Email` value object that validates and normalizes. The domain must not import your DB library.
2. **A `UserRepository` interface** in the application layer with intention-revealing methods, for example `findByEmail(tenantId, email)`, `countActive(tenantId)`, `add(user)`. Every method takes `tenantId`.
3. **A SQL/ORM implementation** (`PostgresUserRepository` or `PrismaUserRepository`) in an infrastructure folder, with explicit `toDomain` / `toRow` mapping functions.
4. **A `CreateUser` use case** that receives its dependencies through the constructor: the repository, a `SeatPolicy` (or `SubscriptionReader`) port, and a `PasswordHasher` port.
5. **A thin route handler** that validates the request shape (zod or similar), calls the use case, maps domain errors to HTTP status codes, and returns a **DTO**, never the raw row.
6. **A composition root** (`container.ts`) where the concrete implementations are wired up.
7. **Tests:** unit tests for `CreateUser` using an `InMemoryUserRepository` and fakes, plus at least one integration test for the real repository against a real database (Docker Postgres or Testcontainers).

## Constraints

- No SQL strings or ORM imports outside the infrastructure folder. Enforce it with an ESLint `no-restricted-imports` rule or dependency-cruiser.
- The response body must never include `password_hash`. Prove it with a test.
- The behavior must stay the same as the legacy handler: same status codes for the same inputs (400, 409, 402, 201).
- No DI framework. Wire everything by hand.
- Write the code yourself. Use AI only to look up documentation.

## How to verify

- Run the unit tests with the database **stopped**. They must pass.
- Run the integration tests with the database **running**. They must pass.
- `grep -rn "SELECT\|INSERT\|prisma\.\|from \"pg\"" src | grep -v infrastructure` returns nothing.
- Hit the endpoint with curl for each case: invalid email, duplicate email, seat limit exceeded, success. Compare the status codes with the legacy behavior.
- Swap `PostgresUserRepository` for `InMemoryUserRepository` in `container.ts` and start the app. It should work end to end (with non-persistent data) without changing any other file.
