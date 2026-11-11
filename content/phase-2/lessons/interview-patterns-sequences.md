## Why this matters

The previous lessons taught you to spot accidental quadratics in real code and to reach for a Map, a sort, binary search, or a heap. Coding interviews test the same skills under different conditions: 35 to 45 minutes, an unfamiliar problem, someone watching, and no database to push the work into.

Most candidates who fail do not fail because they never saw the algorithm. They fail because they start typing before they understand the problem, or because they cannot see which of a dozen known shapes the problem has. The fix is the same for both: a fixed process, and a small catalogue of patterns you can recognize from cues in the problem statement.

This lesson covers the process and seven patterns for arrays, strings, and sequences. The next lesson covers trees, graphs, and dynamic programming. Every pattern gets a template, a worked example, recognition cues, its cost, and a place you would meet it in SaaS or ERP code.

## How to approach any interview problem

Treat this as a checklist you run out loud. Interviewers score communication and process, not only the final code.

| Step | What you do | Typical time |
|---|---|---|
| 1. Clarify | Ask about input size, value ranges, negatives, duplicates, sorted or not, empty input, return format, whether you may mutate input | 2–3 min |
| 2. Examples | Write two or three small inputs with expected outputs, including one edge case | 2–3 min |
| 3. Brute force | State the obvious solution and its complexity. Do not code it unless asked | 1–2 min |
| 4. Optimize | Find the repeated work in the brute force and name the pattern that removes it | 5–10 min |
| 5. Code | Write clean code, narrating decisions. Use helper functions with good names | 10–15 min |
| 6. Test | Trace your code by hand on an example, then on the edge cases. Fix bugs you find | 3–5 min |
| 7. Complexity | State time and space, and what dominates | 1 min |

Step 4 is where patterns live. The question to ask is: "what does the brute force recompute, and which structure would let me remember it?" Two nested loops that re-sum a range suggest prefix sums or a sliding window. Repeated searching suggests a Map, sorting plus two pointers, or binary search. Repeated "find the best remaining item" suggests a heap.

### Constraints are hints

Problem statements usually give limits. Typical online judges allow roughly 10^7 to 10^8 simple operations within the time limit, so the constraint tells you which complexity the intended solution has.

| Input size | Target complexity | Usual technique |
|---|---|---|
| n ≤ 12 | `O(n!)` or `O(2^n * n)` | Backtracking over permutations or subsets |
| n ≤ 25 | `O(2^n)` | Subsets, bitmasks |
| n ≤ 500 | `O(n^3)` | Triple loops, interval DP |
| n ≤ 5,000 | `O(n^2)` | Pairwise comparison, 2D DP |
| n ≤ 10^5 to 10^6 | `O(n log n)` or `O(n)` | Sorting, heap, two pointers, sliding window, hashing |
| Values up to 10^9 | `O(log V)` steps | Binary search on the answer |

If n is 10^5 and your idea is `O(n^2)`, it is the wrong idea. Say so out loud before writing it.

## Pattern 1: Two pointers

Two indices move through the data, and each step discards possibilities that cannot be the answer. There are two shapes: **opposite ends** moving inward (on sorted data), and **read/write** pointers moving in the same direction (in-place compaction, merging).

```ts
// Opposite ends: does a sorted array contain a pair summing to target?
function hasPair(sorted: number[], target: number): boolean {
  let lo = 0, hi = sorted.length - 1;
  while (lo < hi) {
    const sum = sorted[lo] + sorted[hi];
    if (sum === target) return true;
    if (sum < target) lo++; // sorted[lo] is too small even with the largest partner
    else hi--;              // sorted[hi] is too big even with the smallest partner
  }
  return false;
}

// Read/write: remove duplicates from a sorted array in place, return new length
function dedupeSorted(a: string[]): number {
  if (a.length === 0) return 0;
  let write = 1;
  for (let read = 1; read < a.length; read++) {
    if (a[read] !== a[write - 1]) a[write++] = a[read];
  }
  return write;
}
```

The correctness argument matters in interviews. When `sum < target`, `sorted[lo]` cannot pair with anything, because its largest possible partner (`sorted[hi]`) is already too small. So discarding it loses nothing.

**Worked example.** A pricing team wants to know how many pairs of add-on products can be bundled under a price cap. Brute force checks every pair: `O(n^2)`. Sort first, then: if `prices[lo] + prices[hi] <= cap`, then `prices[lo]` also pairs with everything between `lo` and `hi`, so count them all at once.

```ts
function countPairsUnderCap(prices: number[], cap: number): number {
  const p = prices.toSorted((a, b) => a - b);
  let lo = 0, hi = p.length - 1, count = 0;
  while (lo < hi) {
    if (p[lo] + p[hi] <= cap) {
      count += hi - lo; // pairs (lo, lo+1) ... (lo, hi) all fit
      lo++;
    } else {
      hi--;
    }
  }
  return count;
}
// [100, 200, 300, 500], cap 500 -> (100,200) (100,300) (200,300) = 3
```

- **Cues:** sorted input (or sorting is cheap), pairs or triplets with a target, palindromes, in-place removal, merging two sorted lists.
- **Cost:** `O(n)` after an `O(n log n)` sort; `O(1)` extra space.
- **In real code:** reconciling a date-sorted bank statement against a date-sorted ledger, compacting a sorted import batch in place, merging two sorted price lists.

## Pattern 2: Sliding window

A window `[lo, hi]` slides over a sequence while you maintain a running summary of what is inside, instead of recomputing it for every window. The toolkit lesson showed the fixed-size version for rolling totals; interviews lean heavily on the variable-size version.

```ts
// Fixed size k: best 7-day revenue
function maxWindowSum(daily: number[], k: number): number {
  if (daily.length < k) throw new RangeError("fewer days than the window");
  let sum = 0;
  for (let i = 0; i < k; i++) sum += daily[i];
  let best = sum;
  for (let i = k; i < daily.length; i++) {
    sum += daily[i] - daily[i - k]; // add the new day, drop the oldest
    best = Math.max(best, sum);
  }
  return best;
}
```

The variable-size template has one shape you should be able to write from memory:

```
for hi from 0 to n - 1:
    add item[hi] to the window state
    while the window violates the condition (or, for "shortest", while it satisfies it):
        update answer if looking for shortest
        remove item[lo] from the window state; lo++
    update answer if looking for longest
```

**Worked example.** Finance asks: what is the shortest run of consecutive days whose sales reach a target? Sales are non-negative.

```ts
function shortestRunReaching(daily: number[], target: number): number {
  let lo = 0, sum = 0, best = Infinity;
  for (let hi = 0; hi < daily.length; hi++) {
    sum += daily[hi];
    while (sum >= target) {          // window is valid: try to shrink it
      best = Math.min(best, hi - lo + 1);
      sum -= daily[lo++];
    }
  }
  return best === Infinity ? 0 : best;
}
```

Each index enters the window once and leaves once, so the nested `while` does not make this quadratic: total work is `O(n)`. This is the amortized argument from the Big-O lesson, applied to pointers.

The pattern has a precondition people miss: **shrinking the window must move it monotonically toward validity**. With non-negative values, removing an item can only lower the sum. With negative values (refunds, credit notes), removing an item might raise the sum, the window logic breaks, and you need prefix sums instead.

For string problems, the window state is usually a `Map` of character counts or last-seen positions: "longest substring with no repeated character", "longest run of orders from at most two warehouses", "smallest window containing all required SKUs".

- **Cues:** "contiguous subarray or substring", "longest/shortest/maximum window such that...", "at most k distinct".
- **Cost:** `O(n)` time; `O(1)` or `O(alphabet)` space for the window state.
- **In real code:** sliding-window rate limiters, rolling 30-day active users, "longest streak without a stockout", anomaly detection over the last N events.

## Pattern 3: Prefix sums

Precompute running totals once, then answer any range-sum question in `O(1)`. `prefix[i]` is the sum of the first `i` items, so the sum of items in `[l, r)` is `prefix[r] - prefix[l]`.

```ts
function buildPrefix(a: number[]): number[] {
  const p = new Array<number>(a.length + 1).fill(0);
  for (let i = 0; i < a.length; i++) p[i + 1] = p[i] + a[i];
  return p;
}
// Sum of days 10..19: p[20] - p[10]. Answering q queries costs O(n + q), not O(n * q).
```

The leading zero (`p[0] = 0`) removes a whole class of off-by-one bugs; keep it.

**Worked example.** A ledger has daily net movements that can be positive or negative. Auditors want the number of date ranges whose net movement is exactly `k` (often 0: periods that fully cancel out). Sliding window fails because of negatives. Instead: a range `(j, i]` sums to `k` exactly when `prefix[i] - prefix[j] === k`, that is, when an earlier prefix equals `prefix[i] - k`. Count earlier prefixes in a Map as you go.

```ts
function countRangesWithSum(moves: number[], k: number): number {
  const seen = new Map<number, number>([[0, 1]]); // prefix value -> how many times seen
  let prefix = 0, count = 0;
  for (const m of moves) {
    prefix += m;
    count += seen.get(prefix - k) ?? 0;
    seen.set(prefix, (seen.get(prefix) ?? 0) + 1);
  }
  return count;
}
```

This is the same "Map of what I need" idea as Two Sum, applied to running totals (LeetCode 560, Subarray Sum Equals K). Use integer cents: floating-point prefixes drift, and `0.1 + 0.2 - 0.3` is not `0`.

Prefix sums extend to 2D (sum of any rectangle in a grid in `O(1)` after `O(rows * cols)` setup) and to other invertible operations such as XOR and counts.

- **Cues:** many range-sum queries, "subarray sum equals k", negatives present, "number of subarrays with...".
- **Cost:** `O(n)` to build, `O(1)` per range query; `O(n)` space.
- **In real code:** account balance as of any date (opening balance plus prefix of movements), cumulative revenue charts, fast "units sold between day A and day B" on a cached series.

## Pattern 4: Binary search, including on the answer

You already know `lowerBound` on sorted data. The general form is more powerful: **binary search works on any monotonic yes/no question**, not only on arrays. If `ok(x)` is false for small `x` and true from some point on, you can find that point in `O(log range)` calls.

```ts
// Smallest x in [lo, hi] with ok(x) === true, assuming ok is monotonic (false...false true...true).
// Returns hi + 1 if no x qualifies.
function firstTrue(lo: number, hi: number, ok: (x: number) => boolean): number {
  let L = lo, R = hi + 1;
  while (L < R) {
    const mid = L + Math.floor((R - L) / 2);
    if (ok(mid)) R = mid;
    else L = mid + 1;
  }
  return L;
}
```

Pick one convention (here: half-open `[L, R)`, the answer is always inside it) and use it every time. Most binary search bugs come from mixing inclusive and exclusive bounds.

**Worked example: binary search on the answer.** A warehouse must ship a queue of orders in the given order within `D` days. Each day the truck carries orders until the next one would exceed its capacity. What is the minimum truck capacity? (LeetCode 1011.)

There is no sorted array here. But the question "can capacity `c` finish in `D` days?" is monotonic: if `c` works, any larger capacity works too. So search over capacities.

```ts
function minCapacity(weights: number[], days: number): number {
  const feasible = (cap: number): boolean => {
    let used = 1, load = 0;
    for (const w of weights) {
      if (load + w > cap) { used++; load = 0; } // start a new day
      load += w;
    }
    return used <= days;
  };
  let maxW = 0, total = 0;
  for (const w of weights) { maxW = Math.max(maxW, w); total += w; }
  return firstTrue(maxW, total, feasible); // capacity is at least the heaviest order
}
```

Cost: the feasibility check is `O(n)` and runs `O(log(total))` times, so `O(n log S)` where `S` is the total weight. Trying every capacity from 1 upward would be `O(n * S)`.

- **Cues:** sorted data plus "first/last position", "minimum X such that...", "maximum X such that...", a huge value range with a cheap check, rotated sorted arrays.
- **Cost:** `O(log n)` on arrays; `O(check * log range)` on answer spaces.
- **In real code:** finding the effective tax bracket or exchange rate, choosing the smallest batch size that keeps a nightly job inside its window, `git bisect` (binary search over commits for the first bad one).

## Pattern 5: Monotonic stack

A stack whose values stay sorted (always increasing or always decreasing from bottom to top). When a new item breaks the order, you pop items, and **each popped item has just found its answer**: the new item is its "next greater" (or smaller) element.

```ts
// For each i, the index of the next item strictly greater than a[i], or -1
function nextGreater(a: number[]): number[] {
  const res = new Array<number>(a.length).fill(-1);
  const stack: number[] = []; // indices whose values are non-increasing bottom to top
  for (let i = 0; i < a.length; i++) {
    while (stack.length && a[stack[stack.length - 1]] < a[i]) {
      res[stack.pop()!] = i; // a[i] is the first greater value to the right
    }
    stack.push(i);
  }
  return res;
}
```

Store indices, not values: you almost always need the distance or position.

**Worked example.** An inventory dashboard shows, for each day, its "span": how many consecutive days up to and including today had a stock level at or below today's level. A naive backward scan per day is `O(n^2)` on a long rising trend. The previous-greater variant solves it in one pass.

```ts
function spans(levels: number[]): number[] {
  const res: number[] = [];
  const stack: number[] = []; // indices of strictly greater earlier levels
  for (let i = 0; i < levels.length; i++) {
    while (stack.length && levels[stack[stack.length - 1]] <= levels[i]) stack.pop();
    res.push(stack.length ? i - stack[stack.length - 1] : i + 1);
    stack.push(i);
  }
  return res;
}
// levels [100, 80, 60, 70, 60, 75, 85] -> [1, 1, 1, 2, 1, 4, 6]
```

Each index is pushed once and popped at most once, so the total is `O(n)` even though there is a loop inside a loop.

- **Cues:** "next greater/smaller", "previous greater/smaller", "how many days until", spans, "largest rectangle", the brute force scans left or right from every element.
- **Cost:** `O(n)` time, `O(n)` space.
- **In real code:** price history analysis ("days until the price exceeded today's"), stock span charts, and, with the plain (non-monotonic) stack you already know, parsing nested formulas and validating brackets in report templates.

## Pattern 6: Intervals (sort, then sweep)

Business data is full of intervals: bookings, leave requests, subscription periods, price list validity, shifts. Nearly every interval problem starts with **sort by start**, then a single pass.

Define the representation first. Half-open intervals `[start, end)` are the safest default: `[9:00, 10:00)` and `[10:00, 11:00)` touch but do not overlap, and durations are simply `end - start`. Two half-open intervals overlap exactly when `a.start < b.end && b.start < a.end`.

```ts
type Interval = [start: number, end: number]; // half-open [start, end)

function merge(intervals: Interval[]): Interval[] {
  const sorted = intervals.toSorted((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const [s, e] of sorted) {
    const last = out.at(-1);
    if (last && s <= last[1]) last[1] = Math.max(last[1], e); // overlaps or touches: extend
    else out.push([s, e]);
  }
  return out;
}
```

`Math.max` is the classic missed detail: `[1, 10)` followed by `[2, 3)` must stay `[1, 10)`.

**Worked example: maximum overlap (sweep line).** HR wants the peak number of employees on leave at the same time, to check against a staffing minimum. Turn each interval into two events, +1 at start and -1 at end, sort them, and keep a running count.

```ts
function maxConcurrent(intervals: Interval[]): number {
  const events: [time: number, delta: number][] = [];
  for (const [s, e] of intervals) events.push([s, +1], [e, -1]);
  // At equal times, process ends (-1) before starts (+1): half-open intervals that touch do not overlap
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let current = 0, peak = 0;
  for (const [, delta] of events) {
    current += delta;
    peak = Math.max(peak, current);
  }
  return peak;
}
```

The same function answers "minimum meeting rooms" or "minimum loading docks". The tie-break line is what interviewers check.

- **Cues:** "overlapping", "merge", "free time", "minimum rooms", "can a person attend all", "insert into a schedule".
- **Cost:** `O(n log n)` for the sort, then `O(n)`.
- **In real code:** detecting double bookings, computing billable periods across plan changes, validating that price list periods do not overlap. Postgres has native range types and exclusion constraints for this; in an interview, you write the sweep yourself.

## Pattern 7: Heap and top-k

The toolkit lesson built a `MinHeap` and used it for top-k in `O(n log k)`. Interviews use the same heap in three more shapes.

1. **Kth largest:** keep a min-heap of size k; its root is the answer. `O(n log k)`. Quickselect gives `O(n)` average but `O(n^2)` worst case, so mention both.
2. **K-way merge:** merge k sorted lists by keeping one "head" per list in a heap.
3. **Two heaps:** a max-heap for the lower half and a min-heap for the upper half give a running median.

**Worked example: k-way merge.** Each of k warehouses sends a stock-movement log already sorted by timestamp. Build one global timeline without concatenating and re-sorting everything.

```ts
// Uses the MinHeap<T>(score) class from the practical DSA toolkit lesson
function mergeSorted<T>(lists: T[][], key: (x: T) => number): T[] {
  const heap = new MinHeap<{ item: T; list: number; idx: number }>((e) => key(e.item));
  lists.forEach((l, i) => { if (l.length) heap.push({ item: l[0], list: i, idx: 0 }); });
  const out: T[] = [];
  while (heap.size) {
    const { item, list, idx } = heap.pop()!;
    out.push(item);
    if (idx + 1 < lists[list].length) heap.push({ item: lists[list][idx + 1], list, idx: idx + 1 });
  }
  return out;
}
```

The heap never holds more than k entries, so the total cost is `O(N log k)` for N total events, versus `O(N log N)` for concatenate-and-sort. The difference matters when N is large and k is small, and it also works when the logs are streams you cannot hold in memory.

A related trick: "top k most frequent" can be `O(n)` with **bucket sort**, because a frequency can never exceed n. Make an array of n + 1 buckets indexed by count and read from the top bucket down.

JavaScript has no built-in priority queue. In an interview, ask whether you may assume one exists; if not, be ready to write a 25-line binary heap from memory.

- **Cues:** "k largest/smallest/closest/most frequent", "merge k sorted", "always process the cheapest/earliest next", "running median".
- **Cost:** `O(log k)` per push or pop; `O(k)` space.
- **In real code:** best-sellers leaderboards, job schedulers ordered by due date, merging paginated results from several shards or tenants.

## Pattern recognition cheat sheet

| The problem says... | Try first |
|---|---|
| Sorted array, find a pair or triplet | Two pointers |
| Contiguous subarray or substring, longest or shortest | Sliding window |
| Range sums, subarray sum equals k, negatives present | Prefix sums plus a Map |
| Sorted data plus a boundary, or "minimum X such that" | Binary search (on the answer) |
| Next or previous greater or smaller | Monotonic stack |
| Bookings, overlaps, rooms, schedules | Sort by start, sweep |
| Top k, kth largest, merge k sorted, earliest first | Heap |
| Lookups, duplicates, counts, "have I seen this?" | Map or Set (from the hashing lesson) |

Patterns combine. "Smallest window containing all required SKUs" is a sliding window with a Map as its state. "Kth smallest pair distance" is binary search on the answer with a two-pointer feasibility check.

## Common mistakes

- **Coding before clarifying.** You solve the wrong problem, then run out of time for the right one.
- **Mixing binary search conventions.** Pick half-open `[lo, hi)` or inclusive `[lo, hi]` and keep it for the whole function.
- **Sliding window with negative numbers.** Shrinking no longer moves toward validity; use prefix sums.
- **Forgetting to sort** before two pointers or interval merging, or sorting numbers without a comparator.
- **Wrong tie-breaks** in sweep lines, so touching intervals count as overlapping (or the other way round).
- **Claiming `O(n^2)` for an amortized `O(n)` loop**, or the reverse. Explain why each index moves at most once.
- **Silence.** If you are stuck, say what you are considering and why it fails. Interviewers can only give credit, and hints, for thinking they can hear.

## In the real world

You will rarely write `firstTrue` at work, but the reasoning shows up constantly: rolling metrics are sliding windows, balances are prefix sums, schedules are interval sweeps, leaderboards are heaps, and "find the first bad deploy" is binary search. The professional skill is spotting when hand-written code recomputes something a running summary could carry forward.

In interviews, most mid-level loops ask one or two medium problems. The common ones map to these seven patterns plus hashing, trees, and graphs. Interviewers look for a clear process, a correct and readable solution, honest complexity analysis, and testing without being asked.

## Try it

1. Without looking, write `firstTrue`, the variable sliding window template, and `maxConcurrent`. Compare with this lesson and note every difference.
2. Implement `countPairsUnderCap` and a brute-force version. Write a Vitest property-style test that compares them on 1,000 random arrays.
3. Modify `shortestRunReaching` to return the start and end dates of the run, not just its length.
4. Take a slow function from your own codebase that loops inside a loop. Decide which of the seven patterns (or a Map) removes the inner loop, and write down the before and after complexity.
