## Scenario

You are the engineer responsible for the "Sales & Receivables" reporting screen in a multi-tenant ERP. The screen is used heavily at month-end by finance teams. It has three panels, each backed by one query:

1. **Overdue invoices list**: for the current tenant, invoices with status `sent` or `overdue` and `due_date` before today, optionally filtered by customer, sorted by `due_date` ascending, paginated 50 at a time.
2. **Revenue by month**: for the current tenant, the sum of paid invoice totals grouped by month for a selected date range (typically 12 months), optionally filtered by sales region.
3. **Top products**: for the current tenant and a selected date range, the 20 products with the highest invoiced quantity, joined from invoice lines.

Data volumes for the largest tenant: 4 million invoices, 28 million invoice lines, 60,000 customers, 15,000 products. Across all tenants, `invoices` has 40 million rows. Writes are steady during the day (about 30 invoices per second platform-wide), so indexes have a real cost.

Today the screen takes 6 to 14 seconds for large tenants. Your task is to design the indexing and query strategy on paper, before writing any migration, and to justify every decision.

## Starting point

Assume this schema (simplified):

```sql
customers     (id, tenant_id, name, region, created_at)
products      (id, tenant_id, sku, name, category_id)
invoices      (id, tenant_id, customer_id, number, status, issued_at, due_date,
               paid_at, total_cents, open_cents)
invoice_lines (id, invoice_id, tenant_id, product_id, qty, unit_price_cents, line_total_cents)
```

Existing indexes: primary keys only, plus a single-column index on `invoices (customer_id)` that someone added two years ago.

Status distribution: 88% `paid`, 7% `sent`, 3% `overdue`, 2% `draft` or `void`.

## What to build

A design document plus a diagram (use the whiteboard) that covers:

1. **Entity relationship diagram** of the four tables, with cardinalities (one customer to many invoices, one invoice to many lines, one product to many lines) and the tenant boundary.
2. **Index inventory**: every index you would create, with exact column order, sort direction, any `INCLUDE` columns, and any partial `WHERE` predicate. Also say which existing index you would keep or drop.
3. **Access path for each of the three queries**: the SQL you would run, and the plan you expect Postgres to choose (which scan type on which index, which join strategy, whether a sort node is needed), drawn as a flow on the diagram.
4. **Pagination strategy** for the overdue list (offset or keyset, and the cursor columns).
5. **Write-cost analysis**: how many indexes each table carries after your change, which ones are touched by the most frequent writes (invoice creation, status change to `paid`, `open_cents` updates on partial payment), and why the trade is worth it.
6. **A fallback for query 2 and 3** if indexes alone are not enough at month-end: for example a pre-aggregated `monthly_revenue` table maintained on payment, or a materialized view refreshed nightly. State the freshness trade-off.

## Constraints

- No more than 4 new indexes on `invoices` and 2 on `invoice_lines`. Justify each one by the query it serves.
- Every query must be tenant-scoped, and every index you propose for a tenant-scoped query must lead with `tenant_id`.
- Do not propose caching layers (Redis etc.). That is Phase 3. This design is about the database access path.
- The overdue list must return page 1 and page 200 in comparable time.

## How to measure and verify

This is primarily a design problem, but every claim should be testable. In your write-up:

- For each of the three queries, state an expected execution time target (for example, overdue list page under 5 ms, revenue by month under 150 ms, top products for a one-month range under 500 ms) and the expected number of rows read. Be honest where a target needs the fallback: aggregating a full year of lines for the largest tenant (millions of rows) will not fit in 500 ms from indexes alone.
- Optionally, but strongly recommended: seed a scaled-down version (400,000 invoices, 2.8 million lines) and run `EXPLAIN (ANALYZE, BUFFERS)` for each query before and after creating your indexes. Paste the key lines (scan node, rows, buffers, execution time) into the document and note where reality differed from your prediction.
- Include a short "what would change my mind" section: which observed plan or metric would make you revise the design (for example, the planner choosing a Bitmap Heap Scan with millions of heap fetches for query 3).
