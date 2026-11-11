## Why this matters

ERPs are graphs in disguise. A bill of materials is a directed acyclic graph. A chart of accounts is a tree. Month-end close is a set of tasks with dependencies. Duplicate customer records form connected components. Warehouse transfer routes are an unweighted graph. When these structures go wrong in production, the symptoms are infinite loops, stack overflows, "circular reference" errors discovered by a customer, and reports that take minutes because they recompute the same subtotal thousands of times.

Interviews test the same structures, and they are where many self-taught engineers feel weakest, because day-to-day CRUD work rarely forces you to write a traversal or a recurrence. This lesson covers recursion and backtracking, trees, graphs, dynamic programming, and greedy algorithms, each with a template and a worked example. It builds on the previous lesson's process (clarify, examples, brute force, optimize, code, test, complexity) and on the toolkit lesson's stack, queue, tree-building, and heap code.

## Recursion and backtracking

Every recursive function needs a **base case** that stops, and a **recursive case** that moves toward it. Trust the recursion: assume the call on a smaller input returns the right answer, and only write how to combine it.

One JavaScript-specific constraint: the call stack is limited (on the order of ten thousand frames in Node, depending on frame size). Recursion that goes as deep as the input is long, like walking a 100,000-node linked list, will throw `RangeError: Maximum call stack size exceeded`. Balanced trees are fine (depth `O(log n)`); long chains and large grids are not. Know how to convert to an explicit stack.

**Backtracking** is recursion that builds a candidate step by step and undoes each step after exploring it. It enumerates subsets, permutations, and combinations.

```
function backtrack(state):
    if state is a complete solution: record a copy; return
    for each choice available from state:
        if choice cannot lead to a valid solution: skip (prune)
        apply choice          // choose
        backtrack(state)      // explore
        undo choice           // un-choose
```

**Worked example.** A customer sends one lump payment without a remittance advice. Which combinations of their open invoices add up to exactly that amount? (This is Combination Sum II, LeetCode 40.)

```ts
function invoiceCombos(openCents: number[], paymentCents: number, limit = 10): number[][] {
  const amounts = openCents.toSorted((a, b) => a - b); // sorting enables pruning and dedupe
  const results: number[][] = [];
  const path: number[] = [];

  function dfs(start: number, remaining: number): void {
    if (results.length >= limit) return;
    if (remaining === 0) { results.push([...path]); return; } // copy: path keeps changing
    for (let i = start; i < amounts.length; i++) {
      if (amounts[i] > remaining) break;                        // sorted: nothing later fits
      if (i > start && amounts[i] === amounts[i - 1]) continue; // skip identical branches
      path.push(amounts[i]);
      dfs(i + 1, remaining - amounts[i]);
      path.pop();
    }
  }

  dfs(0, paymentCents);
  return results;
}
```

The worst case is `O(2^n)`: every subset. That is acceptable for one customer's 25 open invoices and hopeless for 2,000. The `limit`, the sort-based `break`, and the duplicate skip are what make backtracking usable in practice. The constraints table from the previous lesson applies: n around 20 or less signals backtracking.

- **Cues:** "all combinations/permutations/subsets", "generate every valid...", small n, N-Queens-style placement puzzles.
- **Pitfalls:** pushing `path` instead of a copy; forgetting to undo the choice; missing the duplicate-skip rule.

## Trees

Interview trees are usually binary: `class TreeNode { val: number; left: TreeNode | null; right: TreeNode | null }`. The toolkit lesson covered building trees from `parentId` rows; here the focus is traversals.

### Depth-first: pre-order, in-order, post-order

The three orders differ only in when you handle the node relative to its children.

| Order | Visit node... | Use it for |
|---|---|---|
| Pre-order | before children | Copying a tree, printing an indented outline, passing context down (depth, path, bounds) |
| In-order | between left and right | Reading a BST in sorted order |
| Post-order | after children | Anything that needs children's results first: heights, subtotals, deletion |

Post-order is the one you will use most at work. Rolling up a chart of accounts, where each parent's total is its own postings plus all descendants, is a post-order traversal:

```ts
type Account = { id: string; ownCents: number; children: Account[] };

function rollup(node: Account, totals: Map<string, number>): number {
  let total = node.ownCents;
  for (const child of node.children) total += rollup(child, totals); // children first
  totals.set(node.id, total);
  return total;
}
```

A very common interview shape is **return one thing, track another**. The recursion returns a value the parent needs (height), while a variable outside tracks the real answer. Example: the diameter of a binary tree (LeetCode 543), the longest path between any two nodes, measured in edges.

```ts
function diameter(root: TreeNode | null): number {
  let best = 0;
  function height(n: TreeNode | null): number {
    if (!n) return 0;
    const l = height(n.left);
    const r = height(n.right);
    best = Math.max(best, l + r);   // longest path that bends at n
    return 1 + Math.max(l, r);      // what the parent needs
  }
  height(root);
  return best;
}
```

### Breadth-first: level by level

BFS visits nodes in order of depth, using a queue (or, as below, a "current level" array, which avoids `shift()`).

```ts
function levels(root: TreeNode | null): number[][] {
  const out: number[][] = [];
  let level = root ? [root] : [];
  while (level.length) {
    out.push(level.map((n) => n.val));
    const next: TreeNode[] = [];
    for (const n of level) {
      if (n.left) next.push(n.left);
      if (n.right) next.push(n.right);
    }
    level = next;
  }
  return out;
}
```

Use BFS for "per level" questions (level averages, right-side view, minimum depth) and DFS for almost everything else.

### Binary search trees

A BST guarantees that **every** node in the left subtree is smaller than the node, and **every** node in the right subtree is larger. Search, insert, and delete are `O(h)`, which is `O(log n)` when balanced and `O(n)` when the tree degenerates into a chain (inserting already-sorted keys does this). In-order traversal yields sorted output.

The classic bug in "validate a BST" is checking only each node against its direct children. A tree with root 5, right child 7, and 7's left child 4 passes that check but is invalid, because 4 sits in 5's right subtree. The fix is to pass an allowed `(min, max)` range down the recursion (pre-order), tightening it at each step. Your database's B-tree indexes are the same ordering idea, made wide and shallow for disk.

- **Cues:** hierarchical data, "depth/height/diameter", "path sum", "lowest common ancestor", "level order".
- **Cost:** `O(n)` time for a traversal; `O(h)` space for recursion, `O(width)` for BFS.

## Graphs

A graph is nodes plus edges. Trees are graphs with no cycles and one path between any two nodes; general graphs can have cycles, so **every graph traversal needs a visited set**.

### Representation

Interview inputs are usually an edge list. Convert it to an **adjacency list** first: `O(V + E)` space, and you can iterate a node's neighbors directly.

```ts
function buildGraph(n: number, edges: [number, number][], directed: boolean): number[][] {
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of edges) {
    adj[a].push(b);
    if (!directed) adj[b].push(a);
  }
  return adj;
}
```

Grids are graphs too: each cell is a node, and its up/down/left/right neighbors are edges. "Number of islands" is counting connected components in a grid.

### BFS: shortest path in an unweighted graph

BFS explores nodes in order of distance from the start, so the first time it reaches a node, it has found a shortest path (fewest edges). DFS does not have this property.

**Worked example.** Stock can be transferred between warehouses along approved routes. What is the route with the fewest transfers from `WH-A` to `WH-F`?

```ts
function fewestHops(routes: Map<string, string[]>, from: string, to: string): string[] | null {
  const prev = new Map<string, string | null>([[from, null]]); // doubles as the visited set
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {             // head pointer, no shift()
    const node = queue[head];
    if (node === to) {
      const path: string[] = [];
      for (let cur: string | null = node; cur !== null; cur = prev.get(cur) ?? null) path.push(cur);
      return path.reverse();
    }
    for (const next of routes.get(node) ?? []) {
      if (!prev.has(next)) { prev.set(next, node); queue.push(next); } // mark when enqueued
    }
  }
  return null;
}
```

Mark nodes visited **when you enqueue them**, not when you dequeue them; otherwise the same node can enter the queue many times. Cost: `O(V + E)`.

If edges have different costs (transfer hours, freight prices), BFS is no longer correct. You need Dijkstra's algorithm: the same loop with a min-heap keyed by distance instead of a FIFO queue, `O((V + E) log V)`. For multi-source problems ("minutes until every cell is reached from any rotten orange"), start BFS with all sources in the queue at once.

### Topological sort: ordering with dependencies

A topological order lists the nodes of a directed graph so that every edge goes from earlier to later. It exists only if the graph has no cycle. **Kahn's algorithm** repeatedly takes nodes with no remaining prerequisites.

**Worked example.** Month-end close has tasks with prerequisites: post depreciation before closing the ledger, reconcile banks before running the FX revaluation, and so on. Produce a valid order, or report that the configuration is impossible.

```ts
// deps: [before, after] means `before` must finish before `after` starts
function closeOrder(tasks: string[], deps: [string, string][]): string[] | null {
  const indegree = new Map(tasks.map((t) => [t, 0]));
  const unlocks = new Map<string, string[]>(tasks.map((t) => [t, []]));
  for (const [before, after] of deps) {
    unlocks.get(before)!.push(after);
    indegree.set(after, indegree.get(after)! + 1);
  }
  const order = tasks.filter((t) => indegree.get(t) === 0); // used as the queue
  for (let head = 0; head < order.length; head++) {
    for (const next of unlocks.get(order[head])!) {
      const left = indegree.get(next)! - 1;
      indegree.set(next, left);
      if (left === 0) order.push(next);
    }
  }
  return order.length === tasks.length ? order : null; // leftovers are stuck in a cycle
}
```

Cost: `O(V + E)`. If some tasks never reach indegree 0, they are on a cycle or depend on one. That makes Kahn's algorithm a cycle detector for free, which is exactly how an ERP should reject a bill of materials in which a subassembly (directly or indirectly) contains itself.

### Cycle detection with DFS

The alternative is DFS with three states: unvisited, on the current path, and finished. Meeting a node that is **on the current path** means you followed an edge back into your own ancestry: a cycle.

```ts
function hasCycle(adj: Map<string, string[]>): boolean {
  const state = new Map<string, 1 | 2>(); // 1 = on current path, 2 = finished; missing = unvisited
  const visit = (u: string): boolean => {
    state.set(u, 1);
    for (const v of adj.get(u) ?? []) {
      if (state.get(v) === 1) return true;          // back edge
      if (!state.has(v) && visit(v)) return true;
    }
    state.set(u, 2);
    return false;
  };
  for (const u of adj.keys()) if (!state.has(u) && visit(u)) return true;
  return false;
}
```

A plain visited set is not enough for directed graphs: reaching an already-finished node through a different route (a diamond: A→B, A→C, B→D, C→D) is not a cycle.

### Union-find: dynamic connectivity

Union-find (disjoint set union) tracks which items belong to the same group while you add connections, with near-constant time per operation.

```ts
class UnionFind {
  private parent: number[];
  private rank: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array<number>(n).fill(0);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]]; // path halving keeps trees flat
      x = this.parent[x];
    }
    return x;
  }
  union(a: number, b: number): boolean {
    let ra = this.find(a), rb = this.find(b);
    if (ra === rb) return false; // already connected: in an undirected graph, this edge closes a cycle
    if (this.rank[ra] < this.rank[rb]) [ra, rb] = [rb, ra];
    this.parent[rb] = ra;        // attach the shorter tree under the taller one
    if (this.rank[ra] === this.rank[rb]) this.rank[ra]++;
    return true;
  }
}
```

With both optimizations, the amortized cost per operation is effectively constant (the inverse Ackermann function, below 5 for any realistic n).

ERP use: deduplicating customers. Records that share an email, a tax ID, or a phone number belong to the same real customer, even transitively. Index each identifier in a Map to the first record that had it, union every later record with that one, then group by `find(i)`. That is LeetCode 721 (Accounts Merge) and a real data-cleaning job.

- **Cues:** "connected", "reachable", "shortest number of steps", "prerequisites/order", "islands", "groups", "redundant connection".
- **Choice:** BFS for unweighted shortest paths; DFS for reachability and cycle detection; Kahn for ordering; union-find when edges arrive incrementally or you only need "same group?".

## Dynamic programming

DP applies when a problem has **overlapping subproblems** (the brute force solves the same smaller question many times) and **optimal substructure** (the best answer is built from best answers to smaller questions). The work is in the setup; the code is short.

1. **State:** define `dp(x)` in one plain sentence. "The fewest packs needed to ship exactly q units."
2. **Transition:** how `dp(x)` follows from smaller states. Think about the last decision made.
3. **Base cases:** the smallest states with known answers.
4. **Order:** memoize the recursion (top-down), or fill a table so every dependency is computed first (bottom-up).
5. **Answer:** which state holds the final result.

### 1D example: fewest packs (Coin Change)

A product ships in pack sizes of 1, 4, and 6 units. What is the fewest number of packs for exactly q units? (LeetCode 322 with different names.)

State: `best(q)` = fewest packs totalling exactly q. Transition: the last pack has some size p, so `best(q) = 1 + min over p of best(q - p)`. Base: `best(0) = 0`.

Top-down, the recursion plus a memo:

```ts
function minPacksMemo(packs: number[], qty: number): number {
  const memo = new Map<number, number>();
  function best(rem: number): number {
    if (rem === 0) return 0;
    if (rem < 0) return Infinity;
    const cached = memo.get(rem);
    if (cached !== undefined) return cached;
    let res = Infinity;
    for (const p of packs) res = Math.min(res, 1 + best(rem - p));
    memo.set(rem, res);
    return res;
  }
  const ans = best(qty);
  return ans === Infinity ? -1 : ans;
}
```

Without the memo, this is exponential. With it, each `rem` is computed once. But recursion depth is up to `qty`, so `qty = 100000` overflows the stack. Bottom-up removes the recursion:

```ts
function minPacks(packs: number[], qty: number): number {
  const dp = new Array<number>(qty + 1).fill(Infinity);
  dp[0] = 0;
  for (let q = 1; q <= qty; q++) {
    for (const p of packs) {
      if (p <= q && dp[q - p] + 1 < dp[q]) dp[q] = dp[q - p] + 1;
    }
  }
  return dp[qty] === Infinity ? -1 : dp[qty];
}
```

Cost: `O(qty * packs)` time, `O(qty)` space. This is "pseudo-polynomial": it depends on the numeric value of `qty`, not on the input length, which is worth saying in an interview.

### 2D example: edit distance

Vendor names arrive from bank feeds as "ACME CORP." while your master data says "Acme Corporation". Edit distance (Levenshtein, LeetCode 72) counts the fewest single-character inserts, deletes, and substitutions to turn one string into another.

State: `dp[i][j]` = edits to turn the first `i` characters of `a` into the first `j` characters of `b`. Transition, looking at the last characters: if they match, `dp[i-1][j-1]`; otherwise 1 plus the best of delete (`dp[i-1][j]`), insert (`dp[i][j-1]`), or substitute (`dp[i-1][j-1]`).

```ts
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i; // delete everything
  for (let j = 0; j <= n; j++) dp[0][j] = j; // insert everything
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
```

```
        ""  k  i  t  e
    ""   0  1  2  3  4
    s    1  1  2  3  4
    i    2  2  1  2  3
    t    3  3  2  1  2     "sit" -> "kite": 2 edits (s->k, insert e)
```

Cost: `O(m * n)` time and space. Each row depends only on the previous row, so you can keep two rows and cut space to `O(n)`, a common follow-up. In production, normalize first (case, punctuation, legal suffixes), and in Postgres use the `fuzzystrmatch` extension's `levenshtein()` or `pg_trgm` similarity with an index rather than computing distances for every pair in Node.

- **Cues:** "number of ways", "minimum/maximum cost", "can you reach/form", "longest common/increasing", a choice at each step that affects later options, and a brute force that recomputes the same subproblems.
- **Common 1D shapes:** climbing stairs, house robber, coin change, word break. **2D:** edit distance, longest common subsequence, grid paths, knapsack.

## Greedy algorithms

A greedy algorithm makes the locally best choice at each step and never reconsiders. When it works, it is simpler and faster than DP. It works only when you can argue that the greedy choice is always part of some optimal solution (an "exchange argument": any optimal solution can be changed to include the greedy choice without getting worse).

**Where greedy works:** schedule the maximum number of non-overlapping bookings on one dock by always taking the booking that **ends earliest**. Ending earliest leaves the most room for everything else.

```ts
type Interval = [start: number, end: number]; // half-open

function maxBookings(intervals: Interval[]): number {
  const byEnd = intervals.toSorted((a, b) => a[1] - b[1]);
  let count = 0, freeAt = -Infinity;
  for (const [s, e] of byEnd) {
    if (s >= freeAt) { count++; freeAt = e; }
  }
  return count;
}
```

Sorting by start or by duration instead gives wrong answers; try to construct the counterexamples, it is good practice.

**Where greedy fails:** the pack sizes above. Greedy takes the largest pack that fits: 8 units = 6 + 1 + 1, three packs. The optimum is 4 + 4, two packs. Greedy happens to be optimal for standard currency denominations, which is why it feels right, but not for arbitrary sizes.

Practical rule in interviews: when a greedy idea occurs to you, spend one minute trying to break it with a tiny counterexample. If you cannot break it and can sketch why the choice is safe, use it. If you can break it, the problem probably needs DP.

## Choosing between them

| Situation | Approach |
|---|---|
| Enumerate all valid combinations, small n | Backtracking |
| Hierarchy, rollups, depth, paths in a tree | Tree DFS (usually post-order) |
| Fewest steps, unweighted | BFS |
| Order with prerequisites, detect circular dependencies | Topological sort (Kahn) |
| "Are these in the same group?" as links arrive | Union-find |
| Optimal value with overlapping subproblems | DP (memo first, then table) |
| Optimal value where a provably safe local choice exists | Greedy |

## Common mistakes

- **No visited set in a graph,** or marking visited on dequeue instead of enqueue.
- **Using DFS for shortest paths** in unweighted graphs, or BFS when edges have weights.
- **Validating a BST against direct children only.**
- **Deep recursion in JavaScript** on chains, large grids, or DP over big numeric ranges. Convert to an explicit stack or a table.
- **Recording the backtracking path by reference,** so every result ends up empty.
- **Jumping to DP code before writing the state in words.** If you cannot say what `dp[i]` means in one sentence, the transition will be wrong.
- **Trusting greedy without trying a counterexample.**

## In the real world

Topological sort is how build tools, migration runners, spreadsheet engines, and MRP (material requirements planning) systems decide what to compute first, and their "circular reference" errors are Kahn's leftovers. Post-order rollups compute account and cost-center totals. BFS finds shortest relationships in org charts and routing tables. Union-find and connected components drive customer and supplier deduplication. DP appears in diffing (`git diff` is built on longest-common-subsequence-style algorithms), fuzzy matching, and pricing optimizations. In Postgres, recursive CTEs (from the toolkit lesson) handle many tree and graph walks close to the data; add a cycle guard (Postgres 14+ has a `CYCLE` clause) when the data might not be acyclic.

In interviews, trees and graphs are the most common medium-level topics after arrays and hashing, and DP appears in a significant minority of loops. Being able to write BFS, Kahn's algorithm, and a memoized recursion from memory covers most of them.

## Try it

1. Write `closeOrder` from memory. Add a test where a task depends on itself and one where two tasks depend on each other.
2. Convert `minPacksMemo` into `minPacks` without looking, then reduce `editDistance` to two rows of memory.
3. Implement customer deduplication with `UnionFind` for records with `email`, `taxId`, and `phone`, and test a transitive case (A shares an email with B, B shares a tax ID with C).
4. Find a counterexample showing that "take the shortest booking first" is not optimal for `maxBookings`.
