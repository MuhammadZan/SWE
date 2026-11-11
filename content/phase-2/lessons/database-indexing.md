## Why this matters

The "Invoices" page in your SaaS loads in 80 ms for most tenants. For your biggest customer, with 3 million invoices, it takes 4.2 seconds, and the database CPU graph spikes every time their accounting team refreshes the page. Your TypeScript is not the problem: it receives 50 rows and renders them. The problem is that Postgres reads all 3 million rows from disk to find those 50.

Indexes are the single highest-leverage performance tool you have. A correct index turns seconds into fractions of a millisecond. A wrong one does nothing while slowing every insert. Learning to reason about indexes, and to verify with `EXPLAIN ANALYZE` instead of guessing, is what separates "add an index and hope" from engineering.

## What a table looks like without an index

Postgres stores table rows in a **heap**: 8 KB pages, rows in roughly insertion order, no sorting by any column. To answer `WHERE customer_id = 'c_42'`, the only option without an index is a **sequential scan**: read every page, check every row.

```
heap (invoices table)
+--------+--------+--------+--------+--------+-----
| page 0 | page 1 | page 2 | page 3 | page 4 | ...  (tens of thousands of pages)
+--------+--------+--------+--------+--------+-----
  check    check    check    check    check   ...   every single row
```

Sequential scans are not evil. For small tables, or queries that return a large fraction of the table, they are the fastest option. They become a problem when you want a few rows out of millions.

## B-tree intuition

The default Postgres index is a **B-tree**: a balanced, sorted, wide tree. Each node is a page that holds hundreds of keys, so the tree is very shallow. Three or four levels can cover hundreds of millions of rows.

```
                         [ root:  c_200 | c_500 | c_800 ]
                         /           |          |        \
        [ c_001 .. c_199 ]   [ c_200 .. c_499 ]   ...   [ c_800 .. c_999 ]
               |                     |
   leaf: (c_041, tid) (c_042, tid) (c_042, tid) (c_043, tid) ... --> next leaf
                    |            |
                    v            v
              heap page 812   heap page 3051    (actual rows)
```

Key properties:

- **Leaves are sorted** and linked to each other, so after finding the first match, the database walks sideways to get the rest. This is why B-trees handle `=`, `<`, `>`, `BETWEEN`, `ORDER BY`, and prefix `LIKE 'abc%'`.
- **Leaves store the key plus a pointer (TID)** to the row in the heap. Fetching the actual row means an extra jump to the heap page.
- **Lookup cost is `O(log n)`**, and because the tree is so wide, `log` here means 3 or 4 page reads.

## Reading EXPLAIN ANALYZE

Never guess. Ask Postgres what it did.

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, number, total_cents, issued_at
FROM invoices
WHERE tenant_id = 't_7' AND status = 'overdue'
ORDER BY issued_at DESC
LIMIT 50;
```

Before indexing:

```
Limit  (cost=98213.11..98213.24 rows=50 width=40) (actual time=1842.3..1842.4 rows=50 loops=1)
  Buffers: shared hit=1204 read=61210
  ->  Sort  (cost=98213.11..98290.40 rows=30915 width=40) (actual time=1842.3..1842.3 rows=50 loops=1)
        Sort Key: issued_at DESC
        Sort Method: top-N heapsort  Memory: 31kB
        ->  Seq Scan on invoices  (cost=0.00..97186.00 rows=30915 width=40) (actual time=0.03..1831.9 rows=31877 loops=1)
              Filter: ((tenant_id = 't_7') AND (status = 'overdue'))
              Rows Removed by Filter: 2968123
Planning Time: 0.2 ms
Execution Time: 1842.6 ms
```

How to read it:

- **Read inside-out.** The most indented node runs first and feeds its parent.
- **`cost=A..B`** is the planner's *estimate* in arbitrary units (startup..total). Use it to compare plans, not as milliseconds.
- **`actual time=A..B`** is real milliseconds per loop: time to first row..time to last row.
- **`rows=` estimated vs actual.** A big mismatch (estimated 10, actual 300,000) means stale or insufficient statistics and is a common cause of bad plans. Run `ANALYZE invoices;`.
- **`loops=`** multiply actual time and rows by this for the node's total.
- **`Rows Removed by Filter`** is wasted work. 2.97 million rows read to keep 31,877.
- **`Buffers: shared hit / read`** are 8 KB pages from cache vs disk. `read=61210` is about 478 MB pulled from disk.

The scan node types you will see:

| Node | Meaning |
|---|---|
| Seq Scan | Read the whole table |
| Index Scan | Walk the index, fetch each matching row from the heap |
| Index Only Scan | Answer entirely from the index; no heap visit (when the visibility map allows) |
| Bitmap Index Scan + Bitmap Heap Scan | Collect matching row locations from the index, sort them by page, then read pages in order. Used for medium-sized result sets or combining indexes |

Now add an index (explained below):

```sql
CREATE INDEX CONCURRENTLY invoices_tenant_status_issued_idx
  ON invoices (tenant_id, status, issued_at DESC);
```

After:

```
Limit  (cost=0.56..48.12 rows=50 width=40) (actual time=0.041..0.162 rows=50 loops=1)
  Buffers: shared hit=54
  ->  Index Scan using invoices_tenant_status_issued_idx on invoices  (actual time=0.040..0.155 rows=50 loops=1)
        Index Cond: ((tenant_id = 't_7') AND (status = 'overdue'))
Planning Time: 0.3 ms
Execution Time: 0.19 ms
```

No sort node (rows come out of the index already ordered), no filter, 54 pages instead of 62,000. 1842 ms to 0.19 ms.

Use `CONCURRENTLY` on production tables: a plain `CREATE INDEX` blocks writes for the duration of the build.

## Composite index column order

A composite index on `(a, b, c)` is sorted by `a`, then by `b` within each `a`, then by `c` within each `(a, b)`. Think of a phone book sorted by last name, then first name.

```
(tenant_id, status, issued_at)
t_1 | draft   | 2025-01-03
t_1 | draft   | 2025-02-11
t_1 | paid    | 2025-01-01
t_1 | paid    | 2025-01-09
t_7 | overdue | 2025-03-02   <- WHERE tenant_id='t_7' AND status='overdue'
t_7 | overdue | 2025-03-15      jumps here and reads a contiguous, ordered run
t_7 | paid    | ...
```

The rules that follow:

1. **Leftmost prefix.** The index helps queries filtering on `a`, `(a, b)`, or `(a, b, c)`. A query filtering only on `b` usually cannot use it efficiently (Postgres can sometimes do a full index scan or, from version 18, a skip scan, but do not design around that).
2. **Equality columns first, range or sort column last.** `WHERE tenant_id = ? AND status = ? AND issued_at > ?` wants `(tenant_id, status, issued_at)`. If you put the range column in the middle, `(tenant_id, issued_at, status)`, the database scans the whole date range for that tenant and filters status as it goes.
3. **Match ORDER BY to finish the job.** If the trailing index column matches the sort, Postgres skips the sort and can stop after `LIMIT` rows. That is what made the example above so fast.
4. **Multi-tenant SaaS: `tenant_id` almost always leads.** Nearly every query is scoped by tenant.

"Put the most selective column first" is common advice and often wrong. Equality-vs-range and query shape matter more than selectivity. A column used with `=` in every query belongs before a highly selective column used in a range.

## Covering indexes

An Index Scan still has to visit the heap for each row to get columns not in the index. If the index contains every column the query needs, Postgres can do an **Index Only Scan** and skip the heap.

```sql
-- Dashboard: sum of open balances per customer for a tenant
SELECT customer_id, sum(open_cents)
FROM invoices
WHERE tenant_id = $1 AND status IN ('sent', 'overdue')
GROUP BY customer_id;

CREATE INDEX invoices_open_balance_idx
  ON invoices (tenant_id, status)
  INCLUDE (customer_id, open_cents);
```

`INCLUDE` columns are stored in the leaves but not part of the sort key, so they cost less than adding them as key columns. Index Only Scans depend on the table's visibility map being current, which autovacuum maintains. On a table with heavy updates, `Heap Fetches:` in the plan tells you how often it still had to check the heap.

## Partial indexes

If queries only ever target a slice of the table, index only that slice.

```sql
-- 95% of invoices are 'paid'. The "needs attention" screen only looks at the rest.
CREATE INDEX invoices_unpaid_idx
  ON invoices (tenant_id, due_date)
  WHERE status IN ('sent', 'overdue');
```

The index is a fraction of the size, faster to scan, and cheaper to maintain (paid invoices never touch it). The query's `WHERE` must imply the index predicate for the planner to use it, so write the same condition literally.

Partial unique indexes enforce business rules too:

```sql
-- Only one active price list per customer
CREATE UNIQUE INDEX one_active_price_list
  ON price_lists (customer_id) WHERE active;
```

## Indexes are not free: write cost

Every index must be updated on every `INSERT`, on `DELETE` (eventually, via vacuum), and on `UPDATE` of an indexed column. A table with 12 indexes turns one insert into 13 writes.

Rough consequences:

- **Bulk imports slow down** with each index. For huge one-time loads, it can be faster to drop secondary indexes, load, and rebuild.
- **Updates to indexed columns** prevent Postgres's HOT (heap-only tuple) optimization, increasing write amplification and bloat. Indexing a `last_seen_at` column that updates every request is expensive.
- **Indexes take disk and RAM.** Indexes compete with table data for the buffer cache.

Find indexes that are never used:

```sql
SELECT relname AS table, indexrelname AS index, idx_scan, pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY pg_relation_size(indexrelid) DESC;
```

(Check across all replicas and a full business cycle, such as month-end close, before dropping anything.)

## Why Postgres ignores your index

- **Low selectivity.** If the query matches 40% of rows, a sequential scan is genuinely cheaper than millions of random index lookups. The planner is right.
- **A function on the column.** `WHERE lower(email) = $1` cannot use an index on `email`. Create an expression index: `CREATE INDEX ON customers (lower(email));`
- **Type mismatch.** Comparing a `bigint` column to a `numeric` parameter, or a `timestamptz` to text, can prevent index use.
- **Leading wildcard.** `LIKE '%acme%'` cannot use a B-tree. Use a trigram (`pg_trgm`) GIN index for that.
- **Wrong column order** for the query shape.
- **Stale statistics** making the planner misjudge row counts. `ANALYZE` the table.
- **Tiny table.** Seq scan of 3 pages beats any index.

## Common mistakes

- **Indexing every column individually.** Five single-column indexes rarely beat one well-ordered composite index for the actual query.
- **Range column before equality columns** in a composite index.
- **Forgetting the sort.** The filter is indexed, but `ORDER BY created_at` still forces a sort over thousands of rows.
- **Reading `cost` as milliseconds.** Use `actual time`.
- **Testing on a tiny dev database.** With 500 rows, every plan is a seq scan and everything is fast. Seed realistic volumes.
- **`CREATE INDEX` without `CONCURRENTLY` in production**, locking writes on a hot table.
- **Never removing indexes.** Unused indexes are pure write cost.

## In the real world

The workflow on a mature team: find the slow query from `pg_stat_statements` or APM traces, copy it with realistic parameters, run `EXPLAIN (ANALYZE, BUFFERS)` against a production-sized copy, design one index for the query shape, verify the new plan, then ship the index with `CONCURRENTLY` through a migration. Afterwards, check `pg_stat_user_indexes` to confirm it is being used.

In multi-tenant SaaS, most indexes start with `tenant_id`. In ERPs, the hot paths are usually list screens with filters plus a date sort, and reports with date ranges plus grouping. One composite index per hot query shape, plus a few partial indexes for "active" subsets, covers most needs.

## Try it

1. Create an `invoices` table and seed 2 million rows across 200 tenants with skewed sizes (one tenant has 30%).
2. Run the overdue-invoices query above with `EXPLAIN (ANALYZE, BUFFERS)`. Record execution time and buffers.
3. Create `(status, tenant_id)`, test, drop it. Create `(tenant_id, issued_at, status)`, test, drop it. Create `(tenant_id, status, issued_at DESC)`, test. Explain the difference in each plan.
4. Add `INCLUDE (number, total_cents)` and see if you get an Index Only Scan. Check `Heap Fetches`.
5. Time inserting 100,000 rows with zero secondary indexes and with five. Record the difference.
