## Why this matters

You ship an invoice reconciliation feature. In staging, with 200 invoices and 200 bank payments, it runs in 40 ms. Six months later a customer imports a year of data: 30,000 invoices, 30,000 payments. The request times out, the Node process pins a CPU core at 100%, and every other tenant on that instance sees their dashboards freeze.

Nothing was "wrong" with the code. It returned correct answers. It just did an amount of work that grew with the *square* of the input, and 200 squared (40,000) is a very different number from 30,000 squared (900,000,000).

Big-O notation is the vocabulary for predicting that before it happens. It is not academic decoration. It is the answer to one question you should ask about every loop, query, and data transformation you write:

> When the input gets 10x bigger, how much more work does this do?

If the answer is "10x more", you are probably fine. If it is "100x more", you have a time bomb.

## What Big-O actually measures

Big-O describes the **growth rate** of work (time) or memory (space) as a function of input size, written `n`. It deliberately throws away details:

- **Constants are dropped.** `3n + 20` becomes `O(n)`. Big-O does not care whether your loop body takes 1 or 3 operations; it cares how the count scales.
- **Only the dominant term is kept.** `n^2 + 500n + 10` becomes `O(n^2)`. When `n` is large, the square term swamps everything else.
- **It is usually the worst case.** Searching an array for an invoice ID is `O(n)` even though sometimes it is the first element.

Think of it as the *shape* of the cost curve, not the exact cost.

```
work
 ^
 |                                   O(n^2)  /
 |                                         /
 |                                       /
 |                                    /
 |                                /          O(n log n)
 |                           /         ___----
 |                     /  ___----                O(n)
 |               / ___----  ___________------
 |         /___--______-----
 |   __--___-----_____________________________ O(log n)
 |=========================================== O(1)
 +-------------------------------------------------> n
```

## The common classes, with ERP examples

| Class | Name | 1,000 items | 1,000,000 items | Real example |
|---|---|---|---|---|
| `O(1)` | constant | 1 | 1 | `Map.get(sku)`, array index access, primary-key lookup in a hash |
| `O(log n)` | logarithmic | ~10 | ~20 | Binary search over sorted dates, B-tree index lookup in Postgres |
| `O(n)` | linear | 1,000 | 1,000,000 | Summing all line items, one pass to build a lookup map |
| `O(n log n)` | linearithmic | ~10,000 | ~20,000,000 | Sorting transactions by date |
| `O(n^2)` | quadratic | 1,000,000 | 1,000,000,000,000 | Nested loop matching invoices to payments |
| `O(2^n)` | exponential | astronomical | never finishes | Brute-forcing which combination of payments sums to an invoice total |

The jump from `O(n log n)` to `O(n^2)` is the one that bites web developers most often. At a million rows, it is the difference between 20 million operations (a fraction of a second) and a trillion (hours).

## How to derive complexity by reading code

You do not need math. You need four rules.

### Rule 1: Sequential steps add

```ts
function summarize(invoices: Invoice[]) {
  const total = invoices.reduce((s, i) => s + i.amount, 0); // O(n)
  const overdue = invoices.filter((i) => i.dueDate < today); // O(n)
  return { total, overdueCount: overdue.length };             // O(1)
}
// O(n) + O(n) + O(1) = O(2n + 1) = O(n)
```

Two passes over the data is still linear. Do not contort readable code to save one pass unless you have measured a problem.

### Rule 2: Nested steps multiply

```ts
function matchPayments(invoices: Invoice[], payments: Payment[]) {
  return invoices.map((inv) => ({
    invoice: inv,
    payment: payments.find((p) => p.invoiceId === inv.id), // O(m) inside O(n)
  }));
}
// O(n * m). If both are ~n, that is O(n^2).
```

This is the reconciliation bug from the intro. Notice it does not *look* nested: there is only one visible loop (`map`). The second loop is hidden inside `.find()`. The same is true of `.includes()`, `.indexOf()`, `.filter()`, `.some()`, and `Array.from(set).find()`. **Every array method that scans is a loop.**

### Rule 3: Halving the problem gives a log

```ts
// Find the first transaction on or after a date, in a sorted array
function lowerBound(txs: Tx[], date: number): number {
  let lo = 0, hi = txs.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (txs[mid].postedAt < date) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
// Each iteration halves the range: O(log n)
```

If each step throws away a constant fraction of the remaining work, the number of steps is logarithmic. A million items need about 20 steps.

### Rule 4: Different inputs get different letters

```ts
function applyDiscounts(orders: Order[], rules: DiscountRule[]) {
  for (const o of orders) {
    for (const r of rules) {
      if (r.matches(o)) o.total -= r.amount;
    }
  }
}
// O(orders * rules), written O(n * k)
```

This is not automatically a problem. If `rules` is always under 20, this is effectively linear in orders. Name the variables honestly and ask which ones can grow.

### Hidden costs to watch for

- **Spread in a loop**: `acc = [...acc, item]` inside `reduce` copies the whole array each time. That is `O(n^2)` for what looks like `O(n)`.
- **String concatenation in old engines** and building large strings with `+=` in a loop is usually fine in V8, but building arrays and calling `.join()` is more predictable.
- **`Object.keys(obj).length` inside a loop** is `O(k)` each time.
- **Awaiting a query inside a loop** is `O(n)` round trips, each costing milliseconds. That is the N+1 problem, covered in its own lesson.
- **`array.shift()`** is `O(n)` in most engines because it reindexes. Using an array as a queue with `shift()` in a loop can be quadratic.

```ts
// Slow: O(n^2) because each spread copies acc
const byCustomer = invoices.reduce<Record<string, Invoice[]>>(
  (acc, inv) => ({ ...acc, [inv.customerId]: [...(acc[inv.customerId] ?? []), inv] }),
  {},
);

// Fast: O(n), mutate a local accumulator you own
const byCustomer2 = new Map<string, Invoice[]>();
for (const inv of invoices) {
  const list = byCustomer2.get(inv.customerId);
  if (list) list.push(inv);
  else byCustomer2.set(inv.customerId, [inv]);
}
```

The "immutable reduce with spread" pattern is extremely common in React-influenced code and is one of the most frequent accidental quadratics in TypeScript codebases. Immutability is a great default for shared state. A local accumulator inside a function is not shared state.

## Space complexity

Big-O also describes memory. The same rules apply, but you count what you *allocate*, not what you loop over.

```ts
// O(1) extra space: a running total
let sum = 0;
for (const line of lines) sum += line.qty * line.unitPrice;

// O(n) extra space: a new array the size of the input
const totals = lines.map((l) => l.qty * l.unitPrice);

// O(n) extra space: a Map with one entry per product
const bySku = new Map(products.map((p) => [p.sku, p]));
```

Space matters most in Node because a single process has a heap limit (often around 2 to 4 GB by default depending on version and flags). Loading a million transaction rows as objects can use several hundred megabytes. The common trade-off in this phase is **spending `O(n)` memory to save `O(n^2)` time**: building a Map costs memory, but turns a quadratic match into a linear one. That is almost always a good trade at ERP scale.

When it is not a good trade: exporting 5 million ledger rows to CSV. Loading them all into memory first is `O(n)` space that will crash the process. Streaming them with a cursor is `O(1)` space (a fixed-size buffer) and the right design.

## Amortized cost

Some operations are usually cheap but occasionally expensive. `array.push()` is the classic case. A JavaScript array has a backing store with spare capacity. Most pushes just write into the next slot: `O(1)`. When capacity runs out, the engine allocates a bigger buffer (typically about 1.5x to 2x) and copies everything: `O(n)` for that one push.

```
capacity 4:  [a][b][c][d]           push(e) -> full, reallocate
capacity 8:  [a][b][c][d][e][ ][ ][ ]  next 3 pushes are cheap
capacity 16: ...
```

Because the buffer grows geometrically, the total copying across `n` pushes adds up to at most a constant multiple of `n`. Spread over all pushes, each costs `O(1)` **amortized**. Hash map inserts work the same way: occasional rehashing, constant cost on average.

Why you care: amortized `O(1)` means great throughput, but individual operations can spike. If you are building a latency-sensitive path, a rare resize of a huge Map can show up as a p99 outlier. Usually you can ignore this; occasionally it explains a mysterious spike.

## When Big-O lies

Big-O is a model. It deliberately ignores things that matter in practice.

### Constants matter at small n

An `O(n)` scan of a 10-element array is often faster than an `O(1)` hash lookup, because hashing a string key has overhead and a tiny array fits in a CPU cache line. For lists of status codes, currency codes, or user roles, `array.includes()` is fine. Big-O tells you what happens as `n` grows; if `n` never grows, it tells you little.

### I/O dominates CPU

This is the big one for web developers. A rough sense of scale:

| Operation | Approximate time |
|---|---|
| Read a value from a Map in memory | ~50 nanoseconds |
| Sort 10,000 numbers in V8 | ~1 millisecond |
| Postgres query over the local network | ~0.5 to 2 milliseconds |
| Postgres query to a managed DB in another AZ | ~2 to 10 milliseconds |
| Call a third-party HTTP API | ~50 to 500 milliseconds |

An `O(n)` loop that makes one database query per iteration is "linear" in Big-O, but each unit of work costs a million times more than an in-memory operation. Fifty iterations of a 5 ms query is 250 ms. Meanwhile, an `O(n log n)` sort of the same 50 items in memory takes microseconds.

So when you analyze a function, count **two things separately**: CPU operations, and round trips (database queries, network calls, disk reads). Round trips almost always matter more until `n` is in the hundreds of thousands.

### The database has its own Big-O

`WHERE customer_id = $1` on an unindexed table of 2 million invoices is a sequential scan: `O(n)` disk reads. With a B-tree index, it is `O(log n)`. Your TypeScript can be perfectly efficient and the endpoint still slow because the work moved into Postgres. The indexing lesson covers this in depth.

### Average case vs worst case

Hash map lookup is `O(1)` on average and `O(n)` in the pathological worst case (all keys collide). Quicksort is `O(n log n)` on average and `O(n^2)` in the worst case. For everyday engineering the average case is what you experience, but if your input is attacker-controlled, worst cases become a security concern (hash flooding attacks are real).

## Common mistakes

- **Treating array methods as free.** `.find`, `.includes`, `.filter`, `.indexOf` inside a `.map` or `for` is a nested loop.
- **Spreading accumulators in `reduce`.** Quadratic copying disguised as functional style.
- **Optimizing the wrong layer.** Shaving CPU off an `O(n)` loop while it fires a query per iteration.
- **Over-optimizing tiny inputs.** Replacing a 5-element array with a Map for "performance" adds complexity and no speed.
- **Ignoring which variable grows.** `O(n * k)` where `k` is fixed at 3 is linear. `O(n * m)` where both are customer data is quadratic.
- **Forgetting memory.** Loading a full table into a Map to avoid queries can trade a slow endpoint for an out-of-memory crash.

## In the real world

Senior engineers rarely write Big-O on a whiteboard at work. What they do constantly is a fast mental pass during code review: "this `.find` is inside a loop over line items; how many line items can an order have?" If the answer is "up to 5,000 for wholesale customers", they flag it. If it is "at most 20", they let it go.

The other habit is asking "what is `n` in production?" Pull real numbers: the largest tenant's invoice count, the biggest order's line item count, the size of the product catalog. Big-O plus a realistic `n` gives you a concrete estimate. Big-O without `n` is trivia.

Finally, production performance problems are mostly about I/O shape (N+1, missing indexes, unbounded queries) and only occasionally about in-memory algorithms. But when an in-memory algorithm is the problem, it is almost always an accidental quadratic, and Big-O is how you spot it.

## Try it

1. Write down the complexity of each function, then verify by timing with `n = 1,000`, `10,000`, and `100,000`:

```ts
function a(ids: string[]) {
  return ids.filter((id, i) => ids.indexOf(id) === i); // dedupe
}

function b(ids: string[]) {
  return [...new Set(ids)];
}

function c(lines: { sku: string; qty: number }[]) {
  return lines.reduce<Record<string, number>>(
    (acc, l) => ({ ...acc, [l.sku]: (acc[l.sku] ?? 0) + l.qty }),
    {},
  );
}
```

2. For `a` and `c`, if 10x more input causes roughly 100x more time, you have confirmed `O(n^2)`. Rewrite both to be `O(n)` and re-time.
3. Find one function in your own SaaS codebase that calls `.find` or `.includes` inside a loop. Estimate production `n` for both loops and decide whether it needs fixing.
