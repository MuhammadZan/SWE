## What a strong solution looks like

A strong design starts from the three queries, not the tables. Each panel gets exact SQL, one index designed for its shape, a predicted plan, a latency target and a rows-read estimate. Every proposed index traces back to a query, and every query traces to an index. The write-cost section is honest: it counts indexes per table after the change and says which writes touch which index. And it admits where indexes alone are not enough. Aggregating a year of invoice lines for a 4-million-invoice tenant reads millions of rows however you index it, so the design names a pre-aggregated fallback and its freshness cost.

The diagram is readable without the text: an ERD with `tenant_id` on every table and a visible tenant boundary, plus three distinct access-path flows (index entered, scan type, join, where grouping or sorting happens, where `LIMIT` stops the work), each annotated with expected rows read.

## Reference approach

### Back-of-envelope numbers

Largest tenant: 4M invoices, 28M lines (7 per invoice). Open invoices (`sent` + `overdue`) are 10%, so about 400,000. Over a 3-year history, one month is roughly 110,000 invoices and 780,000 lines; twelve months is about 1.3M invoices and 9M lines. Platform-wide writes are about 30 invoices per second, so about 240 line inserts per second.

### Index inventory

```sql
-- Q1 overdue list: partial, only the ~10% of rows that are open
CREATE INDEX CONCURRENTLY invoices_open_due_idx
  ON invoices (tenant_id, due_date, id)
  INCLUDE (customer_id, number, open_cents, status)
  WHERE status IN ('sent', 'overdue');

-- Q1 with a customer filter
CREATE INDEX CONCURRENTLY invoices_open_customer_due_idx
  ON invoices (tenant_id, customer_id, due_date, id)
  WHERE status IN ('sent', 'overdue');

-- Q2 revenue by month: paid only, covering
CREATE INDEX CONCURRENTLY invoices_paid_month_idx
  ON invoices (tenant_id, paid_at)
  INCLUDE (total_cents, customer_id)
  WHERE status = 'paid';

-- Q3 top products: denormalized issued_at on lines, covering
CREATE INDEX CONCURRENTLY invoice_lines_tenant_issued_idx
  ON invoice_lines (tenant_id, issued_at)
  INCLUDE (product_id, qty);
```

The existing `invoices (customer_id)` index stays: Postgres does not index foreign keys automatically, and deleting or re-keying a customer needs it, as do customer detail pages that list all invoices regardless of status. It does not lead with `tenant_id`, but customer IDs are already tenant-unique. Dropping it is a valid choice only if you replace it with `(tenant_id, customer_id, issued_at DESC)` for the customer page, and say so.

Three new indexes on `invoices` and one on `invoice_lines`, within the limits.

### Access paths

```
Q1 overdue list (keyset)
  invoices_open_due_idx  --Index Only Scan, Index Cond: tenant_id = $1
                           AND due_date < current_date AND (due_date, id) > ($2, $3)-->
  LIMIT 50 stops after ~50 entries --> Nested Loop --> customers_pkey (50 lookups for name)
  rows read: ~50 index entries + 50 customer rows. Target: under 5 ms on every page.
```

```sql
SELECT i.id, i.number, i.due_date, i.open_cents, c.name
FROM invoices i
JOIN customers c ON c.id = i.customer_id
WHERE i.tenant_id = $1
  AND i.status IN ('sent', 'overdue')          -- repeats the partial predicate literally
  AND i.due_date < current_date
  AND (i.due_date, i.id) > ($2, $3)            -- cursor from the last row of the previous page
ORDER BY i.due_date, i.id
LIMIT 50;
```

Page 200 costs the same as page 1 because the row comparison is an index condition: Postgres descends the B-tree straight to the cursor position and reads 50 entries. With `OFFSET 9950` it would walk and discard 9,950 entries first.

The Index Only Scan depends on the visibility map. Invoices that change status often have recently modified heap pages, so expect some `Heap Fetches`; still cheap at 50 rows.

```
Q2 revenue by month (12 months)
  invoices_paid_month_idx --Index Only Scan, tenant_id = $1 AND paid_at in range-->
  ~1.2M index entries --> (region filter: Hash Join to customers filtered by region)
  --> HashAggregate by date_trunc('month', paid_at) --> 12 rows
  Target: 150 ms without region, 300 ms with region. Fallback below if missed.
```

Revenue is bucketed by `paid_at`, which is a decision to state explicitly: finance teams usually mean cash received for a "revenue by payment month" panel, and `issued_at` for invoiced revenue. Pick one and name it.

```
Q3 top products (one month)
  invoice_lines_tenant_issued_idx --Index Only Scan, ~780k entries-->
  HashAggregate by product_id (15k groups) --> top-N heapsort LIMIT 20
  --> Nested Loop to products_pkey (20 lookups)
  Target: under 500 ms for one month. Twelve months (~9M rows): use the fallback.
```

Denormalizing `issued_at` onto `invoice_lines` is the key move. The alternative, `invoice_lines (tenant_id, invoice_id)`, forces a join from 110,000 invoices to their lines with a Nested Loop of 110,000 index probes or a Hash Join over a large lines scan, both far slower. The cost is one extra column written once at insert (invoice dates do not change after issue in most ERPs; if yours allows edits, the update must touch the lines too).

### Write cost

| Table | Indexes after | Invoice creation | Status to paid | `open_cents` update |
| --- | --- | --- | --- | --- |
| invoices | PK, customer_id, 3 new = 5 | PK and customer_id; Q1 partials only if created as `sent` (drafts skip them) | Non-HOT update: new entries in PK, customer_id and the Q2 partial; old Q1 entries stay until vacuum | Non-HOT (`open_cents` is an INCLUDE column): new entries in PK, customer_id and both Q1 partials |
| invoice_lines | PK, 1 new = 2 | Both | None | None |

The important subtlety: an update can only be HOT (heap-only, no index writes) if no indexed column changes, and that includes INCLUDE columns and columns used in partial-index predicates. So a status change or a partial payment writes a new entry into every index the new row version qualifies for, not just the one containing the changed column. At 30 invoices per second this is well within what Postgres handles; the cost is mostly WAL volume and index bloat, which autovacuum manages. If partial payments are very frequent, dropping `open_cents` from the INCLUDE list (and accepting heap fetches on Q1) is a reasonable trade.

### Fallback

A `monthly_product_sales (tenant_id, month, product_id, qty)` and `monthly_revenue (tenant_id, month, region, total_cents)` table, updated in the same transaction as invoice issue and payment (or by a job every few minutes). Twelve-month queries then read hundreds of rows instead of millions. The trade: either extra work in the write transaction and careful handling of refunds and voids, or minutes of staleness. A nightly materialized view is simpler but shows yesterday's numbers, which finance teams at month-end usually will not accept.

## Common mistakes

- **One index per column.** `(status)`, `(due_date)`, `(tenant_id)` separately cannot give the ordering, and a status index has terrible selectivity for `paid`.
- **Range column before equality columns**, such as `(tenant_id, due_date, status)` for Q1, which scans all due dates and filters status.
- **Writing the partial predicate differently in the query**, for example `status <> 'paid'`. The planner must be able to prove the query's `WHERE` implies the index predicate; write it identically.
- **Keyset on `due_date` alone.** Thousands of invoices share a due date; without `id` in the sort and cursor, rows are skipped.
- **Claiming 12-month top products in 500 ms from indexes alone.** Nine million rows must be read and aggregated. That is a pre-aggregation problem.
- **Ignoring write cost** or assuming status changes are free.

## Trade-offs worth discussing

- **Denormalizing `issued_at` onto lines** versus joining: faster reads, one more column to keep consistent.
- **Covering indexes** versus plain ones: Index Only Scans save heap visits but make the index larger and depend on vacuum keeping the visibility map current.
- **Partitioning by month**: helps the reports prune old data and makes archiving cheap, but every query must include the partition key to benefit and unique constraints must include it too.
- **Real-time accuracy versus cost**: an interviewer will ask what finance actually needs at month-end. "Up to five minutes stale" changes the whole design.

## Grade yourself

| Dimension | Strong | Acceptable | Needs work |
| --- | --- | --- | --- |
| Query-first design | Exact SQL per panel; each index named against its query and vice versa | Indexes plausible, SQL sketched | Indexes listed without queries |
| Column order | Equality columns, then the range/sort column, then `id`; partial predicates match the SQL literally | Mostly right, one ordering mistake | Range before equality, or single-column indexes |
| Pagination | Keyset on `(due_date, id)`, explains why page 200 equals page 1 | Keyset without a tiebreaker | OFFSET |
| Numbers | Rows-read estimates and latency targets per query, derived from the volumes | Targets without derivation | No numbers |
| Write cost | Table of indexes per table and per write type, HOT discussed | Index count only | Not discussed |
| Fallback and evidence | Pre-aggregation with freshness trade-off; "what would change my mind" with concrete plan signals | Fallback named only | None |

## Going further

1. Seed the scaled-down dataset, run every query with `EXPLAIN (ANALYZE, BUFFERS)`, and annotate the diagram with real numbers where they differ from your predictions.
2. Implement `monthly_revenue` maintained in the payment transaction, including refunds, and write a reconciliation query that proves it matches the raw invoices.
3. Prototype monthly range partitioning of `invoice_lines` and compare Q3 plans for a one-month and a twelve-month range.
