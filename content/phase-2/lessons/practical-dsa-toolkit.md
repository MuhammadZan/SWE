## Why this matters

You have heard the jargon in interviews and job posts: binary search, heaps, stacks, trees, "two pointers", "sliding window". It is easy to dismiss as LeetCode theatre. But each of these exists because it solves a recurring, concrete problem, and you have probably written a slow version of several of them already:

- A "top 10 customers by revenue" widget that sorts 200,000 rows to keep 10.
- A job runner that uses `array.shift()` as a queue and slows to a crawl when the backlog grows.
- An undo feature in a document editor that clones the entire state on every keystroke.
- A category tree (chart of accounts, product categories, org units) rendered with recursive database queries.

This lesson is the practical toolkit: which structures and algorithms actually appear in SaaS and ERP code, what they cost, and how to recognize when you need one. It is not an exhaustive DSA course. It is the 20% that covers 80% of real work.

## Sorting: what it costs and when to avoid it

Comparison sorting is `O(n log n)`. That is the floor for general-purpose sorting; no comparison sort does better in the worst case. V8's `Array.prototype.sort` uses TimSort, which is `O(n log n)` worst case, **stable** (equal elements keep their original order), and very fast on data that is already partially sorted.

Practical facts:

- **The default sort is lexicographic.** `[10, 9, 100].sort()` gives `[10, 100, 9]`. Always pass a comparator for numbers: `(a, b) => a - b`.
- **The comparator runs `O(n log n)` times.** Do not do expensive work inside it (date parsing, `toLowerCase`, lookups). Precompute a sort key.
- **Stability matters for multi-key sorts.** Sort by secondary key first, then by primary key, and stable sort preserves the secondary order within ties. Or write a single comparator that compares both.
- **`sort` mutates.** Use `toSorted()` (Node 20+) or copy first if the array is shared.

```ts
// Slow: parses dates O(n log n) times
invoices.sort((a, b) => new Date(a.issuedAt).getTime() - new Date(b.issuedAt).getTime());

// Fast: parse once (O(n)), sort on numbers
const keyed = invoices.map((inv) => ({ inv, t: Date.parse(inv.issuedAt) }));
keyed.sort((a, b) => a.t - b.t || a.inv.number.localeCompare(b.inv.number));
const sorted = keyed.map((k) => k.inv);
```

### When not to sort in application code

If the data comes from Postgres, `ORDER BY` in SQL is usually better: the database can read rows in order directly from an index without sorting at all. Sorting in Node makes sense for data you have already combined from multiple sources, or for small result sets.

### When you do not need a full sort

"Top 10 by revenue" does not need all 200,000 rows sorted. A full sort is `O(n log n)`. Keeping a running top-k is `O(n log k)`, and for `k = 10` that is effectively linear. More on that under heaps. Better still, ask the database: `ORDER BY revenue DESC LIMIT 10` with an index on revenue reads only 10 rows.

## Binary search: `O(log n)` lookups on sorted data

If data is sorted, you can find an item or a boundary by repeatedly halving the search range. A million sorted items need about 20 comparisons.

```
find first tx with date >= 2025-03-01

[ Jan ... Feb ... | Mar ... Apr ... May ... Jun ]
 lo               mid                         hi    mid < target -> lo = mid + 1
                  [ Mar ... Apr | May ... Jun ]
                   lo          mid        hi        mid >= target -> hi = mid
                  ...20 steps later: lo points at the first March tx
```

```ts
// Returns the first index where items[i].t >= target (or items.length)
function lowerBound<T>(items: T[], target: number, key: (x: T) => number): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (key(items[mid]) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Range query: transactions in March, from an in-memory sorted array
const start = lowerBound(txs, Date.parse("2025-03-01"), (t) => t.postedAt);
const end = lowerBound(txs, Date.parse("2025-04-01"), (t) => t.postedAt);
const march = txs.slice(start, end);
```

Where this shows up for real:

- **Tax and pricing brackets.** Given a sorted list of thresholds, find which bracket an amount falls into.
- **Exchange rates by date.** Find the most recent rate on or before a transaction date.
- **Time-series in memory.** Range filtering a cached, sorted array of metrics.
- **Inside your database.** A B-tree index lookup is a generalized binary search across disk pages.

The lower-bound form above (find the first position satisfying a condition) is more useful than "find exact match", because business questions are usually about boundaries.

## Stacks and queues

### Stack: last in, first out

`push` and `pop` on a JS array are both `O(1)`. Use a stack for:

- **Undo/redo.** Push commands (or diffs, not whole-state clones) on an undo stack.
- **Depth-first traversal without recursion.** Walking a deep category tree iteratively avoids call-stack overflow.
- **Matching and parsing.** Validating nested formula syntax in a spreadsheet-like feature.

```ts
// Iterative DFS over a chart of accounts (no recursion limit)
function collectDescendants(rootId: string, childrenOf: Map<string, string[]>): string[] {
  const out: string[] = [];
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    out.push(id);
    for (const child of childrenOf.get(id) ?? []) stack.push(child);
  }
  return out;
}
```

### Queue: first in, first out

The trap: `array.shift()` is `O(n)` because it reindexes the array. Using it in a loop over a growing backlog is quadratic.

```ts
// Slow: shift() is O(n), loop is O(n^2) overall
const jobs: Job[] = loadBacklog(); // 100,000 jobs
while (jobs.length) process(jobs.shift()!);

// Fast: move a head pointer instead of shifting
let head = 0;
while (head < jobs.length) process(jobs[head++]);
```

For a long-lived queue that grows and shrinks, use a ring buffer or a small linked-list queue, or (more often) do not build one at all: real job queues belong in Redis, Postgres (`SELECT ... FOR UPDATE SKIP LOCKED`), or a message broker, which Phase 3 covers.

Queues also drive **breadth-first search**, which you need for "shortest path" style questions: how many approval levels between this employee and the CFO, or which warehouses are reachable within two transfer hops.

## Trees at a practical level

You will rarely implement a balanced binary search tree. You will constantly work with tree-*shaped data*:

- Chart of accounts (Assets > Current Assets > Cash > Bank A)
- Product categories
- Org charts and approval hierarchies
- Bill of materials (a product made of subassemblies made of parts)
- Comment threads

The core practical skill is **converting a flat list of rows (each with `parentId`) into a tree in `O(n)`**, rather than the `O(n^2)` approach of filtering children for every node.

```ts
type Row = { id: string; parentId: string | null; name: string };
type Node = Row & { children: Node[] };

// Slow: for each node, filter all rows for its children -> O(n^2)
function buildTreeSlow(rows: Row[], parentId: string | null = null): Node[] {
  return rows
    .filter((r) => r.parentId === parentId)
    .map((r) => ({ ...r, children: buildTreeSlow(rows, r.id) }));
}

// Fast: index once, attach once -> O(n)
function buildTree(rows: Row[]): Node[] {
  const byId = new Map<string, Node>();
  for (const r of rows) byId.set(r.id, { ...r, children: [] });
  const roots: Node[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}
```

To fetch a subtree from Postgres, use a recursive CTE instead of one query per level:

```sql
WITH RECURSIVE sub AS (
  SELECT id, parent_id, name FROM accounts WHERE id = $1
  UNION ALL
  SELECT a.id, a.parent_id, a.name
  FROM accounts a JOIN sub ON a.parent_id = sub.id
)
SELECT * FROM sub;
```

The B-tree in your database is a different kind of tree: a wide, shallow, balanced structure designed for disk. The indexing lesson covers its intuition.

## Heaps: top-k and priority

A binary heap keeps the smallest (or largest) element accessible in `O(1)` and supports insert and remove-top in `O(log n)`. JavaScript has no built-in heap, so you write a small one or use a library.

Two practical uses:

1. **Top-k from a large stream.** Keep a min-heap of size `k`. For each item, if it beats the smallest in the heap, replace it. Cost: `O(n log k)`. Memory: `O(k)`, which matters when streaming millions of rows.
2. **Priority scheduling.** Process the job with the earliest due date first, or the invoice with the highest overdue amount.

```ts
class MinHeap<T> {
  private a: T[] = [];
  constructor(private score: (x: T) => number) {}
  get size() { return this.a.length; }
  peek() { return this.a[0]; }
  push(x: T) {
    this.a.push(x);
    let i = this.a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.score(this.a[p]) <= this.score(this.a[i])) break;
      [this.a[p], this.a[i]] = [this.a[i], this.a[p]];
      i = p;
    }
  }
  pop(): T | undefined {
    const top = this.a[0];
    const last = this.a.pop();
    if (this.a.length && last !== undefined) {
      this.a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.a.length && this.score(this.a[l]) < this.score(this.a[m])) m = l;
        if (r < this.a.length && this.score(this.a[r]) < this.score(this.a[m])) m = r;
        if (m === i) break;
        [this.a[m], this.a[i]] = [this.a[i], this.a[m]];
        i = m;
      }
    }
    return top;
  }
}

// Top 10 customers by revenue while streaming rows
function topK(rows: Iterable<{ customerId: string; revenue: number }>, k: number) {
  const heap = new MinHeap<{ customerId: string; revenue: number }>((r) => r.revenue);
  for (const row of rows) {
    if (heap.size < k) heap.push(row);
    else if (row.revenue > heap.peek()!.revenue) { heap.pop(); heap.push(row); }
  }
  const out = [];
  while (heap.size) out.push(heap.pop()!);
  return out.reverse();
}
```

Honest caveat: for 10,000 items, sorting and slicing is simpler and fast enough. Reach for the heap when `n` is large, when you are streaming and cannot hold everything, or when items keep arriving (a scheduler).

## The NeetCode "Arrays & Hashing" patterns that matter in real code

The roadmap points you at NeetCode's Arrays & Hashing track. Here is the mapping from interview problem to production use, so practice feels connected to your work.

| NeetCode problem | Underlying pattern | Where you use it |
|---|---|---|
| Contains Duplicate | Set membership in one pass | Detect duplicate invoice numbers or webhook event IDs |
| Two Sum | Map of "value I need" to index | Match a payment to the invoice whose open balance equals it |
| Valid Anagram | Frequency counting with a Map | Compare expected vs received stock counts per SKU |
| Group Anagrams | Group by a computed key | Group transactions by normalized merchant name |
| Top K Frequent Elements | Count then bucket/heap | Most-ordered products, most frequent error codes |
| Product of Array Except Self | Prefix/suffix accumulation | Running balances, cumulative totals |
| Longest Consecutive Sequence | Set plus "start of run" check | Find gaps in invoice numbering (an audit requirement in many countries) |
| Encode and Decode Strings | Length-prefixed framing | Building safe composite keys and wire formats |

Two Sum, applied:

```ts
// Find two open invoices from the same customer that together equal a lump payment
function findPair(invoices: { id: string; openCents: number }[], paymentCents: number) {
  const seen = new Map<number, string>(); // amount -> invoice id
  for (const inv of invoices) {
    const needed = paymentCents - inv.openCents;
    const match = seen.get(needed);
    if (match) return [match, inv.id];
    seen.set(inv.openCents, inv.id);
  }
  return null;
}
```

Gap detection in invoice numbering (Longest Consecutive Sequence, reversed):

```ts
function findGaps(numbers: number[]): number[] {
  const present = new Set(numbers);
  const gaps: number[] = [];
  const min = Math.min(...numbers), max = Math.max(...numbers);
  for (let n = min; n <= max; n++) if (!present.has(n)) gaps.push(n);
  return gaps;
}
```

(For very large arrays, replace `Math.min(...numbers)` with a loop; spreading hundreds of thousands of arguments can exceed the call stack limit.)

Two other general patterns worth knowing by name:

- **Two pointers** on sorted data: merging two sorted lists (bank statement lines and ledger entries, both sorted by date) in `O(n + m)` without a Map.
- **Sliding window**: rolling 7-day or 30-day sums over a date-sorted series, updating the sum by adding the new day and subtracting the day that fell out, instead of re-summing the window each time.

## Common mistakes

- **Numeric sort without a comparator.** `[2, 10, 1].sort()` returns `[1, 10, 2]`.
- **Expensive comparators.** Parsing dates or calling `localeCompare` with options on every comparison.
- **Sorting everything to take the top few**, especially after loading the whole table from the database.
- **`shift()` in hot loops.** Quadratic queues.
- **Recursive tree building with `filter`.** Quadratic and also recursion-depth-limited.
- **Querying the database once per tree level or per node**, instead of a recursive CTE or one query for all rows.
- **Implementing a fancy structure for 50 items.** Simplicity wins at small `n`.

## In the real world

Most production DSA is: choose Map/Set over arrays for lookups, push sorting and filtering into the database with indexes, build trees from flat rows in linear time, and avoid accidental quadratics. Heaps and binary search show up in schedulers, pricing engines, rate tables, and analytics code. Explicit trees beyond "flat rows to nested JSON" are rare in app code, but tree-shaped domain data is everywhere in ERPs.

When you study NeetCode problems, do not memorize solutions. After solving one, write a sentence about where that pattern would appear in your own product. That translation step is what turns interview prep into engineering skill.

## Try it

1. Load (or generate) 50,000 account rows with `parentId`. Build the tree with `buildTreeSlow` and `buildTree`. Time both.
2. Generate 1,000,000 `{ customerId, revenue }` rows. Compare `toSorted(...).slice(0, 10)` against the `topK` heap for time and peak memory (`process.memoryUsage().heapUsed`).
3. Given 365 days of daily sales, compute a rolling 30-day total with a sliding window in `O(n)`. Verify against a naive `O(n * 30)` version.
4. Solve Contains Duplicate, Two Sum, and Top K Frequent Elements on NeetCode. For each, write one sentence about where you would use it in an ERP.
