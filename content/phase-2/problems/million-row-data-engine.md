## Scenario

You are building the transactions API for a small fintech-flavoured SaaS: business customers connect bank accounts, and the app shows a searchable, filterable ledger of every transaction. Your biggest tenants have hundreds of thousands of transactions, and the ledger screen must feel instant.

This capstone ties the whole phase together. You will generate a realistic 1,000,000-row dataset, build an API that filters it, measure how slow the naive version is, and then optimize it with composite indexes, correct pagination, and careful in-memory work until the core query runs in well under a millisecond of database execution time.

## Starting point

Postgres 15+ locally (Docker is fine). Node 20+ with TypeScript. Any HTTP framework (Fastify, Express, Next.js route handlers, Hono).

Schema to start with (you may extend it, but keep the column names):

```sql
CREATE TABLE accounts (
  id          bigserial PRIMARY KEY,
  tenant_id   int NOT NULL,
  name        text NOT NULL,
  currency    char(3) NOT NULL
);

CREATE TABLE transactions (
  id            bigserial PRIMARY KEY,
  tenant_id     int NOT NULL,
  account_id    bigint NOT NULL REFERENCES accounts(id),
  posted_at     timestamptz NOT NULL,
  amount_cents  bigint NOT NULL,
  direction     text NOT NULL CHECK (direction IN ('debit', 'credit')),
  category      text NOT NULL,
  counterparty  text NOT NULL,
  status        text NOT NULL CHECK (status IN ('pending', 'posted', 'reversed'))
);
```

Seeding requirements:

- Exactly 1,000,000 transactions.
- 50 tenants with a skewed distribution: tenant 1 owns 30% of rows, tenants 2 to 5 own 10% each, the rest share the remainder.
- 3 to 10 accounts per tenant.
- `posted_at` spread over the last 3 years, with more recent months denser.
- About 20 categories, 2,000 distinct counterparties, status 95% `posted`, 4% `pending`, 1% `reversed`.
- Use a seeded random generator so results are reproducible.
- Insert with `COPY` (via `pg-copy-streams`) or multi-row `INSERT` batches of at least 1,000 rows. Seeding must finish in under 2 minutes. Record how long it took.

## What to build

1. **`GET /tenants/:tenantId/transactions`** with query parameters:
   - `accountId` (optional)
   - `from`, `to` (date range on `posted_at`, optional)
   - `status` (optional, default `posted`)
   - `category` (optional)
   - `minAmount` (optional, in cents)
   - `limit` (default 50, max 200)
   - `cursor` (opaque keyset cursor)

   Results ordered by `posted_at DESC, id DESC`. Response includes `data`, `nextCursor`, and a `meta` object with `queryMs` (database execution time measured around the query).

2. **`GET /tenants/:tenantId/transactions/summary`** returning, for the same filters, total debits, total credits, and the top 5 counterparties by absolute amount. Decide which parts happen in SQL and which (if any) in memory, and justify it.

3. **A naive baseline**: the same endpoints with no secondary indexes and `LIMIT/OFFSET` pagination. Keep this version in the repo (a flag or separate route) so you can benchmark against it.

4. **The optimized version**:
   - Composite indexes designed for the actual filter combinations. Justify column order in the README.
   - Keyset pagination with a unique sort.
   - Only the columns needed in `SELECT`, no `SELECT *`.
   - Account names joined in a way that does not produce N+1 queries.
   - If you do any in-memory work (for example, merging, top-k, or grouping), use appropriate structures (Map, heap) rather than nested loops or full sorts.

5. **A benchmark harness** (`npm run bench`) that, for a fixed set of 6 representative queries (see below), runs each 200 times and reports p50, p95, p99 of both database execution time and full HTTP latency, for the naive and optimized versions.

Representative queries:

- Q1: tenant 1, default filters, first page.
- Q2: tenant 1, page 200 (follow cursors, or OFFSET 9,950 for the naive version).
- Q3: tenant 1, one account, last 30 days.
- Q4: tenant 1, category `software`, last 12 months, `minAmount` 100000.
- Q5: tenant 37 (small tenant), default filters.
- Q6: summary endpoint for tenant 1, last 90 days.

## Constraints

- Hand-write the SQL, indexes, cursor encoding, and seed script. Use AI only for documentation lookup.
- No caching layer (Redis, in-process LRU) in this phase. The point is to make the database access path fast.
- At most 4 secondary indexes on `transactions`. Every index must serve at least one representative query, shown by `EXPLAIN`.
- All filters must use parameterized queries.

## How to measure and verify

- Run `ANALYZE transactions;` after seeding and after creating indexes.
- For each representative query, save the `EXPLAIN (ANALYZE, BUFFERS)` output before and after optimization in a `plans/` folder.
- Targets for the optimized version on a typical laptop: Q1, Q2, Q3, Q5 database execution time under 1 ms at p50; Q4 under 5 ms at p50; Q6 under 50 ms at p50. Full HTTP p95 under 20 ms for Q1 to Q5 with 10 concurrent connections.
- Q2 must show that page 200 costs about the same as page 1 in the optimized version, and dramatically more in the naive version.
- Record the cost of your indexes: total index size (`pg_indexes_size('transactions')`) and the time to insert 50,000 additional rows before and after creating them.
- Put a before/after table for all 6 queries in the README, with machine specs and Postgres version.
