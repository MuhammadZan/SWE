import type { LessonMeta, ProblemMeta } from "@/lib/types";

export const interviewLessons: LessonMeta[] = [
  {
    slug: "interview-patterns-sequences",
    title: "Interview Patterns I: Arrays, Strings, and Sequences",
    summary:
      "A repeatable process for live coding problems, plus seven patterns (two pointers, sliding window, prefix sums, binary search on the answer, monotonic stack, intervals, heaps) with templates, recognition cues, and ERP analogues.",
    minutes: 60,
    keyTakeaways: [
      "Run the same process every time: clarify, examples, brute force, optimize, code, test, state complexity; the optimize step asks what the brute force recomputes.",
      "Input constraints reveal the intended complexity: n around 10^5 rules out O(n^2), and value ranges up to 10^9 with a cheap check suggest binary search on the answer.",
      "Two pointers and sliding windows are O(n) because each index moves forward at most once, but sliding windows require that shrinking moves toward validity, which negative values break.",
      "Prefix sums answer range sums in O(1), and a Map of earlier prefixes counts subarrays with a target sum even when values are negative.",
      "A monotonic stack finds the next or previous greater element for every item in O(n) total, and interval problems almost always start with sorting by start.",
      "Heaps cover top-k, kth largest, k-way merge, and running medians in O(log k) per operation; be ready to write one, since JavaScript has none built in.",
    ],
    quiz: [
      {
        question:
          "An interviewer gives you open invoice amounts already sorted ascending and asks whether any two add up exactly to a payment. You propose a hash map. They ask whether you can do better on memory. What do you suggest?",
        options: [
          "Two pointers from both ends, moving the low pointer up when the sum is too small and the high pointer down when it is too large: O(n) time and O(1) extra space",
          "Binary search for every pair, giving O(log n) total time",
          "Sort the array again with a numeric comparator to make the hash map smaller",
          "A sliding window of size 2 moved across the array",
        ],
        answer: 0,
        explanation:
          "Because the input is sorted, each comparison safely discards one end: if the sum is too small, the low value cannot pair with anything. That is O(n) time with no extra memory. Binary search per element would be O(n log n). A size-2 window only checks adjacent pairs.",
      },
      {
        question:
          "Daily ledger movements include refunds, so values can be negative. Auditors want the number of date ranges whose net movement is exactly zero. A colleague writes a sliding window. What is the problem and the better approach?",
        options: [
          "Sliding windows cannot handle zero as a target; use binary search instead",
          "Negative values mean shrinking the window does not reliably move it toward the target, so use prefix sums with a Map counting how often each prefix value has appeared",
          "The window must be fixed size; set it to 30 days",
          "Sort the movements first so the window works",
        ],
        answer: 1,
        explanation:
          "A range sums to zero exactly when two prefix sums are equal. Counting earlier prefix values in a Map solves it in O(n) regardless of sign. The sliding window relies on monotonic behavior that negatives break, and sorting destroys the date order that defines a range.",
      },
      {
        question:
          "Orders must ship in sequence within 5 days, and each day's truck load cannot exceed its capacity. Total weight is up to 10^9 units and there are 50,000 orders. How do you find the minimum capacity efficiently?",
        options: [
          "Try every capacity from 1 upward until one works",
          "Sort the orders by weight and use two pointers",
          "Binary search over capacities between the heaviest order and the total weight, using an O(n) greedy check of whether a capacity finishes in 5 days",
          "Use a heap to always load the heaviest remaining order first",
        ],
        answer: 2,
        explanation:
          "Feasibility is monotonic: if a capacity works, every larger one works. Binary search on the answer needs about 30 checks of O(n) each. Trying every capacity could take up to 10^9 checks, and sorting or a heap ignores the requirement to ship in order.",
      },
      {
        question:
          "For each of 100,000 days of price history you need the number of days until a higher price. The nested-loop version times out on a long downward trend followed by a spike. What is the standard fix?",
        options: [
          "Memoize the inner loop with a Map keyed by price",
          "A monotonic stack of indices: when a higher price arrives, pop every lower price and record the distance, giving O(n) total",
          "Sort the prices and binary search for the next higher one",
          "Use prefix sums of price differences",
        ],
        answer: 1,
        explanation:
          "Each index is pushed and popped at most once, so the stack approach is O(n). Sorting loses the day order the question depends on, prefix sums answer range totals rather than next-greater queries, and memoizing by price does not capture position.",
      },
      {
        question:
          "Your docks-needed function converts bookings into +1/-1 events and sorts by time. For bookings 9:00 to 10:00 and 10:00 to 11:00 it reports 2 docks, but one dock is enough. What is the bug?",
        options: [
          "Events should be sorted by duration instead of time",
          "The function should merge intervals before counting",
          "At equal timestamps, end events must be processed before start events, because half-open intervals that touch do not overlap",
          "The +1 and -1 values should be swapped",
        ],
        answer: 2,
        explanation:
          "With half-open intervals, a booking ending at 10:00 frees the dock for one starting at 10:00. If the start is processed first, the count briefly reaches 2. Sorting ties so that -1 comes before +1 fixes it. Merging would hide the information you need to count concurrency.",
      },
    ],
    resources: [
      { label: "NeetCode Roadmap", url: "https://neetcode.io/roadmap", kind: "interactive" },
      { label: "Tech Interview Handbook", url: "https://www.techinterviewhandbook.org/", kind: "web" },
      { label: "LeetCode", url: "https://leetcode.com/", kind: "interactive" },
    ],
  },
  {
    slug: "interview-patterns-trees-graphs-dp",
    title: "Interview Patterns II: Trees, Graphs, DP, and Greedy",
    summary:
      "Templates and worked ERP examples for backtracking, tree traversals, BFS, topological sort, cycle detection, union-find, dynamic programming, and greedy algorithms, and how to tell which one a problem needs.",
    minutes: 65,
    keyTakeaways: [
      "Backtracking is choose, explore, un-choose; it is exponential, so it fits small inputs, and pruning plus duplicate skipping make it practical.",
      "Post-order traversal computes children first and powers rollups like chart-of-accounts totals; validating a BST requires passing min and max bounds down, not comparing with direct children.",
      "BFS gives shortest paths in unweighted graphs when nodes are marked visited on enqueue; weighted edges need Dijkstra with a heap.",
      "Kahn's topological sort orders dependencies such as a bill of materials or month-end close tasks in O(V + E), and any nodes left over reveal a cycle.",
      "Union-find answers 'same group?' in near-constant time and suits incremental links such as deduplicating customers that share emails or tax IDs.",
      "For DP, define the state in one sentence, write the transition from the last decision, memoize, then convert to a table to avoid JavaScript stack limits; use greedy only after failing to find a counterexample.",
    ],
    quiz: [
      {
        question:
          "An ERP stores bill-of-materials lines (assembly uses component). Planning needs a build order, and the system must reject configurations where a subassembly indirectly contains itself. Which approach fits best?",
        options: [
          "BFS from the finished product, building items in the order visited",
          "Kahn's topological sort: repeatedly build items with no unbuilt components; if some items are never processed, they are on or behind a cycle",
          "Sort items alphabetically and build them in that order",
          "Union-find over the BOM lines",
        ],
        answer: 1,
        explanation:
          "Topological sort produces an order in which every component precedes its assemblies, in O(V + E), and detects cycles as a by-product. BFS from the top gives the reverse dependency order and does not detect cycles. Union-find tracks undirected connectivity and loses edge direction.",
      },
      {
        question:
          "Stock can move between warehouses along approved routes, each counted as one transfer. A colleague uses recursive DFS to find the route with the fewest transfers and gets long, roundabout routes. What should they use?",
        options: [
          "BFS from the source, which reaches each warehouse first along a path with the fewest edges",
          "DFS with a larger stack size",
          "Dijkstra's algorithm is required for any shortest path",
          "Topological sort of the route graph",
        ],
        answer: 0,
        explanation:
          "DFS finds a path, not the shortest one. BFS explores in order of distance, so the first time it reaches the target it has used the fewest edges. Dijkstra also works but is only necessary when edges have different weights, and the route graph may contain cycles, so topological sort does not apply.",
      },
      {
        question:
          "A product ships in packs of 1, 4, and 6 units. The current code always takes the largest pack that fits and ships 8 units as 6 + 1 + 1. A customer points out that 4 + 4 is fewer packs. How should this be solved?",
        options: [
          "Sort pack sizes in descending order before applying the greedy rule",
          "Take the smallest pack first instead",
          "Dynamic programming over quantities: the fewest packs for q is 1 plus the minimum over pack sizes p of the fewest packs for q - p",
          "Use binary search on the number of packs",
        ],
        answer: 2,
        explanation:
          "The greedy choice is not safe for arbitrary pack sizes, as this counterexample shows. DP (Coin Change) considers every last pack and reuses solutions to smaller quantities in O(qty x packs). Changing the greedy order does not fix the underlying problem.",
      },
      {
        question:
          "A BST validator checks that each node's left child is smaller and right child is larger. It accepts root 5 with right child 7, where 7 has left child 4. Why is this wrong, and what is the fix?",
        options: [
          "4 is in 5's right subtree, so it must be greater than 5; pass an allowed min and max range down the recursion and tighten it at each step",
          "The validator should use BFS instead of DFS",
          "BSTs may not contain values smaller than the root anywhere",
          "The check should compare each node with its grandparent as well",
        ],
        answer: 0,
        explanation:
          "The BST property applies to entire subtrees, not just direct children. Carrying bounds (or checking that the in-order traversal is strictly increasing) catches violations at any depth. Adding a grandparent check only moves the bug one level deeper.",
      },
      {
        question:
          "You need to merge 200,000 customer records into real customers, where any two records that share an email, phone, or tax ID belong together, even transitively. What is the most suitable structure?",
        options: [
          "Compare every pair of records, which is O(n^2)",
          "A min-heap ordered by customer name",
          "Sort by email and merge adjacent records only",
          "Union-find: map each identifier to the first record that had it, union later records with that one, then group records by their root",
        ],
        answer: 3,
        explanation:
          "Union-find handles transitive links in near-constant time per operation, so the whole job is roughly linear. Pairwise comparison is about 2 x 10^10 checks. Sorting by email misses links through phone or tax ID, and a heap does not track groups.",
      },
    ],
    resources: [
      { label: "VisuAlgo: animated data structures and algorithms", url: "https://visualgo.net/en", kind: "interactive" },
      { label: "CP-Algorithms", url: "https://cp-algorithms.com/", kind: "web" },
      { label: "NeetCode Roadmap", url: "https://neetcode.io/roadmap", kind: "interactive" },
    ],
  },
];

export const interviewProblems: ProblemMeta[] = [
  {
    slug: "interview-pattern-drills",
    title: "Interview Pattern Drills",
    kind: "exercise",
    summary:
      "Solve 20 classic problems grouped by pattern and 3 ERP-flavored originals under interview time limits, with Vitest tests for each and an honest progress log that drives spaced re-practice.",
    estimatedHours: 24,
    needsDiagram: false,
    requirements: [
      "All 20 curated problems and the 3 originals have a solution file and a Vitest test file; each test file covers the given examples plus at least 3 edge cases (such as empty input, a single element, duplicates, or touching intervals).",
      "Every attempt is timed: Easy within 20 minutes, Medium within 35, Hard within 50, originals within 45. Overruns or any use of hints are recorded as 'no' in the README.",
      "The README table lists, for every problem: name, pattern, time complexity, space complexity, time taken, solved without hints (yes/no), and a second-attempt column.",
      "Every 'no' problem is re-solved from a blank file at least 7 days after the first attempt, with the date and time of the second attempt recorded.",
      "Each solution file begins with a time and space complexity comment that matches the code, including recursion stack space where relevant.",
      "assemblyStages returns the documented stages for the bike example, returns a real cycle (each item uses the next) for cyclic input, and handles 5,000 items and 20,000 BOM lines in under 100 ms.",
      "busyBlocks, freeSlots, and docksNeeded produce the documented outputs for the dock example, treat touching bookings as non-overlapping, and process 100,000 bookings in under 200 ms.",
      "SkuLeaderboard.topK runs in O(m log k) without sorting all SKUs, honors the units-descending then SKU-ascending order, and matches a sort-based reference on 10,000 random events.",
    ],
    hints: [
      "Before coding, name the pattern out loud and write the template's skeleton as comments. Most failed attempts skip this and fight details without a structure.",
      "If you stall for 10 minutes, write the brute force and its complexity, then ask what it recomputes. That repeated work points to the pattern.",
      "For Original A, process Kahn's algorithm in waves: everything with zero pending components forms the current stage, and the assemblies that reach zero while processing it form the next.",
      "For Original A's cycle, note that every unbuilt item still has at least one unbuilt component. Follow unbuilt components from any unbuilt item and record positions until a node repeats.",
      "For Original C, keep a size-k heap whose root is the worst entry kept so far, using a comparator that includes the SKU tie-break; pop everything at the end and reverse.",
    ],
    rubric: [
      "Is my README log honest, including overruns and hint usage, so it actually tells me which patterns to study?",
      "Do my tests include edge cases I thought of myself, not only the examples from the statement?",
      "Could I explain each solution's complexity and its key insight to an interviewer without looking at the code?",
      "Did I re-solve every missed problem from scratch after at least a week, rather than re-reading my old solution?",
      "Do the three originals validate their input and produce deterministic output that another engineer could rely on?",
    ],
    stretchGoals: [
      "Add a 60-minute sliding time window to SkuLeaderboard, expiring old events with a queue and a head pointer.",
      "Add explode(top, qty, bom) to Original A, returning total purchased-part quantities with memoization so shared subassemblies are computed once.",
      "Solve 10 additional medium problems from the NeetCode 150 in your weakest two patterns and add them to the log.",
      "Do two mock interviews with a peer on unseen problems, solving out loud, and write a short retrospective for each.",
    ],
    repoChecklist: [
      "README with setup, how to run the tests (npx vitest), and the full progress table including second attempts.",
      "One folder per pattern containing each solution file and its test file.",
      "An originals/ folder with the three ERP problems, their tests, and a small benchmark script for the performance requirements.",
      "A short 'weak patterns' section in the README naming the two patterns with the most 'no' rows and what you did about them.",
    ],
    relatedLessons: [
      "interview-patterns-sequences",
      "interview-patterns-trees-graphs-dp",
      "practical-dsa-toolkit",
      "arrays-vs-hash-maps",
      "big-o-notation",
    ],
  },
];
