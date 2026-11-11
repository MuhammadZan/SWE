## What a strong solution looks like

A strong capstone reads like a performance PR from a senior engineer. There is a reproducible seed (fixed random seed, `COPY`, under a minute), a naive version kept for comparison, an optimized version with at most four indexes, and a `plans/` folder where every index appears in at least one saved plan. The README has a before/after table for all six queries, with database execution time and HTTP latency reported separately, and says what the machine was.

The API is correct before it is fast. An automated test suite runs against a small deterministic fixture in a real Postgres and covers every filter, `limit` validation, malformed cursors, ties on `posted_at`, and the query count per request. Pagination walks every page of the fixture and asserts the union equals a plain `ORDER BY` with no duplicates. The write-up is honest about the cost of the indexes in megabytes and insert time, and about which target, if any, was missed and why.

## Reference approach

### Query shapes drive the indexes

| Query | Equality | Range | Sort |
| --- | --- | --- | --- |
| Q1, Q2, Q5 default list | tenant, status | (cursor) | posted_at DESC, id DESC |
| Q3 one account, 30 days | tenant, account, status | posted_at | posted_at DESC, id DESC |
| Q4 category, 12 months, minAmount | tenant, category, status | posted_at, amount | posted_at DESC, id DESC |
| Q6 summary, 90 days | tenant, status | posted_at | none (aggregate) |

```sql
CREATE INDEX tx_tenant_status_posted_idx
  ON transactions (tenant_id, status, posted_at DESC, id DESC);

CREATE INDEX tx_tenant_account_status_posted_idx
  ON transactions (tenant_id, account_id, status, posted_at DESC, id DESC);

CREATE INDEX tx_tenant_category_status_posted_idx
  ON transactions (tenant_id, category, status, posted_at DESC, id DESC);
```

Three indexes, each with every equality column first and the sort columns last, so `LIMIT` stops the scan after 50 matching rows. `status` sits before `posted_at` because it is always an equality filter (default `posted`). Q6 reuses the first index. A fourth index is optional; a common choice is a covering index for the summary, `(tenant_id, status, posted_at) INCLUDE (direction, amount_cents, counterparty)`, which turns Q6 into an Index Only Scan. Only add it if the plan proves it is needed.

For Q4, `minAmount` cannot be an index condition after the sort columns, so the planner walks the category index in `posted_at DESC` order and applies `amount_cents >= $n` as a filter, stopping once it has 51 matches. Adding `INCLUDE (amount_cents)` does not help here: the list selects columns that are not in the index, so it is a plain Index Scan and the filter runs after each heap fetch. Whether Q4 hits 5 ms depends on how selective the amount filter is; read `Rows Removed by Filter` in the plan and report it. If it removes tens of thousands of rows, that is the evidence for a different index, not a guess.

### Keyset query and cursor

```sql
SELECT t.id, t.posted_at, t.posted_at::text AS cursor_ts, t.amount_cents, t.direction,
       t.category, t.counterparty, t.status, a.name AS account_name
FROM transactions t
JOIN accounts a ON a.id = t.account_id
WHERE t.tenant_id = $1
  AND t.status = $2
  AND (t.posted_at, t.id) < ($3::timestamptz, $4::bigint)
ORDER BY t.posted_at DESC, t.id DESC
LIMIT $5;   -- requested limit + 1, to compute hasMore without COUNT
```

Build the SQL from the filters that are present rather than `($x IS NULL OR col = $x)` chains, which can hide index conditions from the planner. Parameterize every value.

The cursor is base64url JSON of `{ postedAt: cursor_ts, id }`. Using the database's text form avoids the classic bug where a JavaScript `Date` truncates microseconds and the next page skips rows. Validate the decoded cursor (shape, timestamp parses, id is a positive integer) and return 400 on failure.

Account names come from a JOIN to `accounts` (a handful of rows per tenant, Nested Loop on the primary key), so a list request is exactly one query. An acceptable alternative is a second `WHERE id = ANY($1)` query stitched with a Map; either way, at most two.

### Summary in SQL

```sql
WITH f AS (
  SELECT direction, amount_cents, counterparty
  FROM transactions
  WHERE tenant_id = $1 AND status = 'posted' AND posted_at >= $2 AND posted_at < $3
)
SELECT
  (SELECT sum(amount_cents) FILTER (WHERE direction = 'debit')  FROM f) AS debits,
  (SELECT sum(amount_cents) FILTER (WHERE direction = 'credit') FROM f) AS credits,
  (SELECT json_agg(x) FROM (
     SELECT counterparty, sum(abs(amount_cents)) AS total
     FROM f GROUP BY counterparty ORDER BY total DESC LIMIT 5) x) AS top_counterparties;
```

The CTE is referenced three times, so Postgres materializes it once. Tenant 1 has roughly 30,000 to 50,000 rows in 90 days; reading and aggregating them takes about 10 to 30 ms. Pulling those rows into Node to aggregate would add transfer and allocation cost for no benefit.

### Tests

```ts
it("walks every page without gaps or duplicates", async () => {
  const seen: string[] = [];
  let cursor: string | null = null;
  do {
    const res = await api.get(`/tenants/1/transactions?limit=7${cursor ? `&cursor=${cursor}` : ""}`);
    expect(res.status).toBe(200);
    seen.push(...res.body.data.map((r: { id: string }) => r.id));
    cursor = res.body.nextCursor;
  } while (cursor);
  const expected = await expectedIdsInOrder(1); // plain ORDER BY posted_at DESC, id DESC
  expect(seen).toEqual(expected);
});
```

The fixture deliberately includes several rows with identical `posted_at` and a page size that splits them across pages. Other tests cover each filter against hand-computed expected IDs, `limit=500` clamping to 200, `cursor=garbage` returning 400, and the query counter reporting at most 2.

### Expected numbers

On a recent laptop with Postgres 16 or 17: Q1, Q2, Q3, Q5 execute in 0.1 to 0.5 ms server-side, Q4 in 0.5 to 5 ms, Q6 in 10 to 40 ms. Naive versions run 100 to 400 ms for tenant 1 (sequential scan plus top-N sort). An OFFSET variant on the optimized index takes 5 to 20 ms at page 200 versus about 0.2 ms at page 1. Three or four indexes on 1M rows add roughly 100 to 200 MB, and inserting 50,000 rows typically takes 2 to 4 times longer with them than without.

## Common mistakes

- **Showing OFFSET degradation only against the no-index baseline.** Both pages do a full scan there, so they look similar. Compare against OFFSET on the same index.
- **Non-unique keyset sort**, or a cursor built from a truncated JavaScript `Date`.
- **`ORDER BY posted_at DESC` with an index on `(tenant_id, posted_at)` and a status filter in between**, so the planner filters many rows or sorts.
- **Reporting `queryMs` from Node as database execution time.** It includes the round trip and pool checkout.
- **Measuring only tenant 1.** Small tenants can get worse plans when statistics are skewed; Q5 must meet its target too.
- **Pagination tests on data with no ties**, which cannot catch the tiebreaker bug.
- **Five or six indexes "just in case"**, each costing write time with no plan using it.

## Trade-offs worth discussing

- **Index count versus write cost.** Each extra index slows the seed and every insert; the benchmark makes that concrete.
- **`status` in the index versus a partial index** `WHERE status = 'posted'`. Partial is smaller, but then non-default status filters need another path.
- **JOIN versus batched account lookup.** Same query budget; the JOIN is simpler, the batch keeps the transactions query cacheable on its own.
- **Exact counts.** A total row count on every request costs a scan; most ledger UIs drop it or use an estimate.
- **Partitioning.** Monthly partitions help retention and range scans at 10M+ rows but add planning overhead and constraints at 1M.

## Grade yourself

| Dimension | Strong | Acceptable | Needs work |
| --- | --- | --- | --- |
| Index design | 3 or 4 indexes, each in a saved plan, column order justified per query | Indexes work, justification thin or one unused | Single-column indexes or more than 4 |
| Pagination | Keyset on `(posted_at, id)`, microsecond-safe cursor, 400 on bad cursor, page 200 within 2x of page 1 | Keyset works, cursor edge cases untested | OFFSET, or ties skip rows |
| Tests | `npm test` covers every filter, limit clamping, bad input, full page walk with ties, query count | Pagination test only | No automated tests |
| Measurement | 200 runs per query, p50/p95/p99, DB and HTTP separate, both tenant sizes, machine specs | Percentiles for HTTP only | Single timings or averages |
| Index cost | Index size and insert-time comparison in README with numbers | Size only | Not measured |
| Reproducibility | Seed under 2 minutes with fixed seed, one-command setup, plans committed | Seed works, manual steps | Results cannot be reproduced |

## Going further

1. Add a streaming CSV export with a server-side cursor and show flat heap usage at 10 million rows.
2. Add `pg_trgm` counterparty search and measure the GIN index's size and insert cost against its read benefit.
3. Scale to 10 million rows and report which targets still hold. The ones that break tell you where partitioning or pre-aggregation starts to pay.
