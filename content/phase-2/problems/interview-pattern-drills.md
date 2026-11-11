## Scenario

You have an interview loop coming up, and at least one round will be a live coding exercise. Reading about patterns is not the same as producing a correct solution in 35 minutes while explaining your thinking. This exercise is deliberate practice: a curated set of classic problems grouped by pattern, plus three originals drawn from ERP work, solved under time pressure, tested, and logged honestly so you can see where you are weak.

## Starting point

Create a TypeScript repo (Node 20+, Vitest). One folder per pattern, one file per problem, one test file next to it:

```
src/
  two-pointers/three-sum.ts
  two-pointers/three-sum.test.ts
  ...
  originals/assembly-stages.ts
  originals/assembly-stages.test.ts
README.md
```

For the curated problems, read the statement on LeetCode (or NeetCode, which has free explanations for most of them), copy the examples into your tests, and add your own edge cases. Run each on LeetCode too if you like, but your local tests are the deliverable.

## The curated set

Time limits: Easy 20 minutes, Medium 35 minutes, Hard 50 minutes. Start a timer before reading the statement.

| Pattern | Problem | Difficulty |
|---|---|---|
| Two pointers | 3Sum (LeetCode 15) | Medium |
| Two pointers | Container With Most Water (LeetCode 11) | Medium |
| Sliding window | Best Time to Buy and Sell Stock (LeetCode 121) | Easy |
| Sliding window | Longest Substring Without Repeating Characters (LeetCode 3) | Medium |
| Prefix sums | Continuous Subarray Sum (LeetCode 523) | Medium |
| Binary search | Search in Rotated Sorted Array (LeetCode 33) | Medium |
| Binary search on the answer | Koko Eating Bananas (LeetCode 875) | Medium |
| Monotonic stack | Daily Temperatures (LeetCode 739) | Medium |
| Intervals | Insert Interval (LeetCode 57) | Medium |
| Heap | Kth Largest Element in an Array (LeetCode 215) | Medium |
| Heap | Merge k Sorted Lists (LeetCode 23) | Hard |
| Trees (BFS) | Binary Tree Right Side View (LeetCode 199) | Medium |
| Trees (DFS) | Validate Binary Search Tree (LeetCode 98) | Medium |
| Graphs (grid) | Number of Islands (LeetCode 200) | Medium |
| Graphs (topological sort) | Course Schedule (LeetCode 207) | Medium |
| Graphs (union-find) | Redundant Connection (LeetCode 684) | Medium |
| Backtracking | Subsets (LeetCode 78) | Medium |
| DP (1D) | House Robber (LeetCode 198) | Medium |
| DP (2D) | Longest Common Subsequence (LeetCode 1143) | Medium |
| Greedy | Jump Game (LeetCode 55) | Medium |

## The three originals

Time limit: 45 minutes each. All use integer inputs only; no floating point.

### Original A: Assembly stages from a bill of materials

```ts
export type BomLine = { assembly: string; component: string; qty: number };
export type StagesResult =
  | { ok: true; stages: string[][] }
  | { ok: false; cycle: string[] };

export function assemblyStages(items: string[], bom: BomLine[]): StagesResult;
```

`items` lists every unique item code. Each BOM line says that `assembly` directly uses `component`, so the component must be built (or received) first. Return production **stages**: stage 0 contains every item that uses no components; each later stage contains every item whose components all appear in earlier stages and which could not have gone into an earlier stage. Sort each stage alphabetically so the output is deterministic. Items within a stage can be built in parallel.

- A line that references an item not in `items` throws an `Error`.
- Duplicate lines for the same pair are allowed and count as one dependency.
- If the BOM contains a cycle (including an item that uses itself), return `{ ok: false, cycle }`, where each item in `cycle` directly uses the next one and the last uses the first.

```
items: BIKE, FRAME, WHEEL, TIRE, RIM, SPOKE, TUBE, BOLT
lines: BIKE<-FRAME, BIKE<-WHEEL, WHEEL<-TIRE, WHEEL<-RIM, WHEEL<-SPOKE,
       WHEEL<-BOLT, TIRE<-TUBE, FRAME<-BOLT
stages: [[BOLT, RIM, SPOKE, TUBE], [FRAME, TIRE], [WHEEL], [BIKE]]
```

### Original B: Loading dock bookings

```ts
export type Booking = { ref: string; dockId: string; start: number; end: number };
// start and end are minutes since midnight, half-open [start, end)

export function busyBlocks(bookings: Booking[]): Map<string, [number, number][]>;
export function freeSlots(
  bookings: Booking[], dockId: string, open: number, close: number, minMinutes: number,
): [number, number][];
export function docksNeeded(bookings: Booking[]): number;
```

- `busyBlocks`: per dock, the merged busy periods sorted by start. Overlapping or touching bookings merge (`[480, 540)` and `[540, 600)` become `[480, 600)`). A booking with `start >= end` throws a `RangeError`.
- `freeSlots`: the gaps on one dock between `open` and `close` that are at least `minMinutes` long. Bookings partly outside opening hours are clipped.
- `docksNeeded`: the minimum number of docks that could host every booking if bookings could be reassigned freely. Touching bookings can share a dock.

```
D1: A [480,540)  B [530,600)  C [600,630)  D [700,720)
D2: E [500,560)
busyBlocks D1 -> [[480,630], [700,720]]
freeSlots(D1, open 480, close 1020, min 30) -> [[630,700], [720,1020]]
docksNeeded -> 3   (A, B and E all overlap at 530-540)
```

### Original C: Top-k selling SKUs from a stream

```ts
export type SaleEvent = { sku: string; qty: number; kind: "sale" | "return" };

export class SkuLeaderboard {
  record(event: SaleEvent): void;
  topK(k: number): { sku: string; units: number }[];
}
```

Net units per SKU = sales minus returns. `topK` returns the k SKUs with the highest positive net units, ordered by units descending, then SKU ascending. SKUs with net units of zero or less never appear. `qty` must be a positive integer, otherwise `record` throws a `RangeError`. `record` must be `O(1)`. `topK` must run in `O(m log k)` time and `O(k)` extra memory for m distinct SKUs: no sorting of all SKUs.

```
sale A 5, sale B 3, sale C 5, return A 1, sale D 2, sale B 2
topK(3) -> [{ B, 5 }, { C, 5 }, { A, 4 }]
```

## Constraints

- No AI assistants or solution lookups during a timed attempt. If you look at a hint or solution, the attempt counts as "with hints".
- Every solution file starts with a comment stating time and space complexity.
- Use the standard library only. Write your own heap and union-find.

## How to measure and verify

Your README holds a table with one row per problem: problem, pattern, time complexity, space complexity, time taken, solved without hints (yes/no), and a second-attempt column. Any problem marked "no", or finished over its time limit, gets re-solved from a blank file at least 7 days later. The table is your progress report: patterns with several "no" rows are what to study next.
