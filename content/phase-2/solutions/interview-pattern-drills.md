## What a strong solution looks like

A strong repo is an honest training log, not a gallery of perfect answers. Every problem has a solution file with a complexity comment, a test file that covers the given examples plus edge cases (empty input, a single element, duplicates, all-equal values, the largest sizes the constraints allow), and a README row that matches reality, including the "no" rows. Problems that went badly have a dated second attempt. The three originals read like production code: clear types, input validation, deterministic output, and tests that check properties (every component appears before its assembly) rather than only one hard-coded answer.

The second signal is that the solutions use the pattern on purpose. A strong 3Sum is sort plus two pointers with explicit duplicate skipping, not a Set of stringified triplets that happens to pass.

## Reference approach

### Original A: assembly stages

Kahn's algorithm, processed in waves so each wave becomes a stage. When it stalls, every unbuilt item still has at least one unbuilt component, so following unbuilt components from any unbuilt item must eventually revisit a node: that loop is the cycle.

```ts
export type BomLine = { assembly: string; component: string; qty: number };
export type StagesResult = { ok: true; stages: string[][] } | { ok: false; cycle: string[] };

// Time O(V log V + E), space O(V + E)
export function assemblyStages(items: string[], bom: BomLine[]): StagesResult {
  const usedBy = new Map<string, string[]>();       // component -> assemblies using it
  const componentsOf = new Map<string, string[]>(); // assembly -> its components
  const pending = new Map<string, number>();        // assembly -> components not yet built
  for (const item of items) {
    usedBy.set(item, []);
    componentsOf.set(item, []);
    pending.set(item, 0);
  }

  const seen = new Set<string>();
  for (const { assembly, component } of bom) {
    if (!pending.has(assembly) || !pending.has(component)) {
      throw new Error(`Unknown item in BOM line ${assembly} <- ${component}`);
    }
    const key = `${assembly}\u0000${component}`;
    if (seen.has(key)) continue; // duplicate line: still one dependency
    seen.add(key);
    usedBy.get(component)!.push(assembly);
    componentsOf.get(assembly)!.push(component);
    pending.set(assembly, pending.get(assembly)! + 1);
  }

  const stages: string[][] = [];
  let current = items.filter((i) => pending.get(i) === 0).sort();
  let built = 0;
  while (current.length) {
    stages.push(current);
    built += current.length;
    const next: string[] = [];
    for (const component of current) {
      for (const assembly of usedBy.get(component)!) {
        const left = pending.get(assembly)! - 1;
        pending.set(assembly, left);
        if (left === 0) next.push(assembly);
      }
    }
    current = next.sort();
  }
  if (built === items.length) return { ok: true, stages };

  // Walk from any unbuilt item through unbuilt components until a node repeats.
  const start = items.find((i) => pending.get(i)! > 0)!;
  const position = new Map<string, number>();
  const walk: string[] = [];
  let node = start;
  while (!position.has(node)) {
    position.set(node, walk.length);
    walk.push(node);
    node = componentsOf.get(node)!.find((c) => pending.get(c)! > 0)!;
  }
  return { ok: false, cycle: walk.slice(position.get(node)!) };
}
```

Tests worth having: the bike example; an item that uses itself (`cycle` is `[X]`); a three-node cycle hanging off a valid subtree (the cycle must not include the valid nodes); duplicate lines; an unknown item; a property test that, for random DAGs, every component's stage index is lower than its assembly's.

### Original B: loading docks

Sort and merge per dock, walk the merged blocks with a cursor for gaps, and sweep starts and ends for concurrency.

```ts
export type Booking = { ref: string; dockId: string; start: number; end: number };
type Block = [start: number, end: number];

// Time O(n log n), space O(n)
export function busyBlocks(bookings: Booking[]): Map<string, Block[]> {
  const byDock = new Map<string, Block[]>();
  for (const b of bookings) {
    if (!(b.start < b.end)) throw new RangeError(`Booking ${b.ref}: start must be before end`);
    let list = byDock.get(b.dockId);
    if (!list) byDock.set(b.dockId, (list = []));
    list.push([b.start, b.end]);
  }
  for (const [dock, list] of byDock) {
    list.sort((a, b) => a[0] - b[0]);
    const merged: Block[] = [];
    for (const [s, e] of list) {
      const last = merged.at(-1);
      if (last && s <= last[1]) last[1] = Math.max(last[1], e);
      else merged.push([s, e]);
    }
    byDock.set(dock, merged);
  }
  return byDock;
}

// Time O(n log n), space O(n)
export function freeSlots(bookings: Booking[], dockId: string, open: number, close: number, minMinutes: number): Block[] {
  const busy = busyBlocks(bookings.filter((b) => b.dockId === dockId)).get(dockId) ?? [];
  const free: Block[] = [];
  let cursor = open;
  for (const [s, e] of busy) {
    if (e <= cursor) continue;  // ends before the window (or the cursor)
    if (s >= close) break;      // starts after closing
    if (s - cursor >= minMinutes) free.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (close - cursor >= minMinutes) free.push([cursor, close]);
  return free;
}

// Time O(n log n), space O(n)
export function docksNeeded(bookings: Booking[]): number {
  const starts = bookings.map((b) => b.start).sort((a, b) => a - b);
  const ends = bookings.map((b) => b.end).sort((a, b) => a - b);
  let inUse = 0, peak = 0, j = 0;
  for (const s of starts) {
    while (j < ends.length && ends[j] <= s) { j++; inUse--; } // `<=`: touching bookings share
    inUse++;
    peak = Math.max(peak, inUse);
  }
  return peak;
}
```

Tests worth having: touching bookings (merge into one block, need one dock); a booking fully inside another; a booking starting before `open` or ending after `close`; a dock with no bookings (one slot covering the whole day if long enough); `start === end` throws.

### Original C: top-k SKUs

A Map holds net units per SKU (`O(1)` per event). `topK` streams the Map through a size-k heap whose root is the **worst** entry kept so far, so a candidate only enters if it beats the root.

```ts
class Heap<T> {
  private a: T[] = [];
  // before(x, y) === true means x belongs closer to the root than y
  constructor(private before: (x: T, y: T) => boolean) {}
  get size() { return this.a.length; }
  peek(): T | undefined { return this.a[0]; }
  push(x: T): void {
    const a = this.a;
    a.push(x);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.before(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop(): T | undefined {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length && last !== undefined) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && this.before(a[l], a[m])) m = l;
        if (r < a.length && this.before(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

export type SaleEvent = { sku: string; qty: number; kind: "sale" | "return" };
type Entry = { sku: string; units: number };

// Ranks first on the leaderboard: more units, then SKU ascending
const better = (x: Entry, y: Entry) => x.units > y.units || (x.units === y.units && x.sku < y.sku);

export class SkuLeaderboard {
  private units = new Map<string, number>();

  // O(1)
  record(e: SaleEvent): void {
    if (!Number.isInteger(e.qty) || e.qty <= 0) throw new RangeError(`Invalid qty ${e.qty} for ${e.sku}`);
    const delta = e.kind === "sale" ? e.qty : -e.qty;
    this.units.set(e.sku, (this.units.get(e.sku) ?? 0) + delta);
  }

  // Time O(m log k), extra space O(k)
  topK(k: number): Entry[] {
    if (k <= 0) return [];
    const heap = new Heap<Entry>((x, y) => better(y, x)); // root = worst entry kept
    for (const [sku, units] of this.units) {
      if (units <= 0) continue;
      const entry = { sku, units };
      if (heap.size < k) heap.push(entry);
      else if (better(entry, heap.peek()!)) { heap.pop(); heap.push(entry); }
    }
    const out: Entry[] = [];
    while (heap.size) out.push(heap.pop()!);
    return out.reverse(); // popped worst-first
  }
}
```

Tests worth having: the given example; ties broken by SKU; a SKU driven to zero or below by returns disappears; `k` larger than the number of SKUs; a cross-check against `toSorted(...).slice(0, k)` on 10,000 random events.

### Pattern notes for the curated set

- **3Sum (15):** sort, fix `i`, two pointers on the rest. Skip duplicate values of `i`, and after recording a triplet move both pointers past duplicates. `O(n^2)`.
- **Container With Most Water (11):** start at both ends and always move the shorter wall; moving the taller one can never increase the area. `O(n)`.
- **Best Time to Buy and Sell Stock (121):** track the minimum price so far and the best `price - min`. One pass, `O(1)` space.
- **Longest Substring Without Repeating Characters (3):** Map of character to last index; `lo = Math.max(lo, last + 1)`. Forgetting `Math.max` moves the window backwards.
- **Continuous Subarray Sum (523):** prefix sums modulo k in a Map from remainder to **first** index, seeded with `0 -> -1`; a repeat at distance at least 2 is the answer.
- **Search in Rotated Sorted Array (33):** at each step one half is sorted; check whether the target lies in that half's range. Be consistent with inclusive bounds.
- **Koko Eating Bananas (875):** binary search speeds from 1 to `max(piles)`; hours are the sum of `Math.ceil(pile / speed)`. The lower bound is 1, not 0.
- **Daily Temperatures (739):** monotonic stack of indices; the answer for a popped index is `i - index`.
- **Insert Interval (57):** the input is already sorted, so no sort is needed: copy intervals ending before the new one, merge overlapping ones into it, copy the rest. `O(n)`.
- **Kth Largest (215):** a size-k min-heap is `O(n log k)`. Quickselect is `O(n)` on average and `O(n^2)` worst case without a random pivot; mention both.
- **Merge k Sorted Lists (23):** heap of list heads plus a dummy head node, `O(N log k)`. Pairwise divide-and-conquer merging has the same bound with no heap.
- **Right Side View (199):** BFS by level and take the last node, or DFS visiting right first and record the first node seen at each depth.
- **Validate BST (98):** pass `(min, max)` bounds down, or check that the in-order traversal is strictly increasing. Comparing only with direct children is the classic failure.
- **Number of Islands (200):** flood fill each unvisited land cell. Grids can be up to 300 x 300, so recursive DFS can reach 90,000 frames; use an explicit stack or BFS in JavaScript.
- **Course Schedule (207):** Kahn's algorithm; possible exactly when all courses get processed. Edge `[a, b]` means b comes before a; reversing it is a common bug.
- **Redundant Connection (684):** union-find over the edges in order; the first edge whose `union` returns false is the answer. Nodes are 1-indexed.
- **Subsets (78):** backtracking with include/exclude, or start from `[[]]` and double. Push copies, not the shared path. Output is `2^n` subsets, so `O(n * 2^n)` is optimal.
- **House Robber (198):** `best = max(skip, take)` where take is `prev2 + nums[i]`; two variables give `O(1)` space.
- **Longest Common Subsequence (1143):** the edit distance grid with a different transition: match gives `dp[i-1][j-1] + 1`, otherwise `max(dp[i-1][j], dp[i][j-1])`.
- **Jump Game (55):** greedy furthest reach; fail if `i` ever exceeds it.

## Common mistakes

- **Logging only successes.** A README full of "yes" rows that took 70 minutes each hides exactly what you need to fix. Time-limit overruns count as "no".
- **Tests that only copy LeetCode examples.** Most interview bugs are edge cases: empty input, one element, duplicates, negative numbers, touching intervals.
- **Complexity comments that do not match the code,** for example claiming `O(n)` for a solution that sorts, or forgetting recursion stack space.
- **Original A:** returning only "has a cycle" instead of the cycle; non-deterministic stage order; double-counting duplicate BOM lines in one place but not the other.
- **Original B:** treating touching bookings as overlapping (or the reverse), and forgetting `Math.max` when merging a contained booking.
- **Original C:** sorting every SKU in `topK`, wrong heap direction (keeping the k smallest), or ignoring the tie-break.

## Trade-offs worth discussing

- **Heap vs sort for top-k.** For 2,000 SKUs, `toSorted().slice()` is simpler and fast enough. The heap wins when m is large, k is small, or data is streamed. In production a Redis sorted set (`ZINCRBY` and `ZRANGE ... REV`) or a SQL `ORDER BY ... LIMIT` over a summary table may beat both.
- **If `topK` is called after every event,** recomputing is `O(m log k)` per call; an incrementally maintained ordered structure becomes worth its complexity.
- **Kahn vs DFS for the BOM.** Kahn gives stages and cycle detection naturally; DFS post-order gives an order but needs the three-state cycle check and is recursion-depth-limited for deep BOMs.
- **Dock storage format.** Minutes since midnight keep the logic simple but break across midnight and DST; real systems use timestamps with time zones, or Postgres `tstzrange` with an exclusion constraint to prevent double bookings at write time.

## Grade yourself

| Dimension | Strong | Acceptable | Needs work |
|---|---|---|---|
| Coverage | All 20 curated and 3 originals attempted, each with a test file | At least 15 curated and all 3 originals | Fewer than 15, or originals missing |
| Timed performance | At least 14 of 20 solved within the limit without hints on the first try | At least 10 within the limit | Fewer than 10, or times not recorded |
| Spaced repetition | Every "no" re-solved 7+ days later, with date and time logged | Most "no" rows re-solved | No second attempts |
| Tests | Examples plus at least 3 edge cases per problem; property tests for the originals | Examples plus some edge cases | Examples only, or tests missing |
| Complexity | Comments match the code, including recursion stack space | Mostly correct, minor slips | Missing or wrong |
| Originals | Match the reference behavior, including the cycle path, tie-breaks, and clipping | Core behavior correct, an edge case missed | Wrong output on the given examples |

## Going further

1. Add a sliding time window to `SkuLeaderboard`: top-k over the last 60 minutes, expiring old events with a queue and a head pointer.
2. Extend Original A with `explode(top, qty, bom)`, returning the total quantity of every purchased part for an order, memoizing per-item results so shared subassemblies are computed once.
3. Do a mock interview: have a friend pick an unseen medium problem and watch you solve it out loud in 35 minutes, then compare your process to the seven steps.
