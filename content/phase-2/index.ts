import type { PhaseMeta } from "@/lib/types";

export const phase: PhaseMeta = {
  id: 2,
  slug: "performance",
  title: "Code Performance & Resource Scaling",
  tagline: "Big-O Notation, Practical DSA, Database Optimization",
  objective:
    "Strip the academic jargon from Data Structures and Algorithms (DSA) and understand how code choices impact memory and database limits.",
  overview:
    "Most performance problems in SaaS and ERP software are not exotic. They are accidental quadratic loops hidden inside array methods, queries fired once per row, tables scanned end to end because an index is missing or ordered wrong, and list endpoints that get slower with every page. This phase gives you the vocabulary and the tools to spot each of these before your largest customer does.\n\nYou will start with Big-O as a practical reading skill, move to the data structures that matter in everyday backend code (hash maps, sets, sorting, binary search, heaps, tree-shaped data), then go down into Postgres: how B-tree indexes work, how to read EXPLAIN ANALYZE, how to design composite indexes, and how to eliminate N+1 queries.\n\nThe phase ends with measurement discipline: benchmarking that is not fooled by the JIT, profiling, percentiles, and keyset pagination. The capstone has you seed a million-row ledger and drive its core query to sub-millisecond execution time, with before and after numbers to prove it.",
  lessons: [
    {
      slug: "big-o-notation",
      title: "Big-O Notation: Reading the Cost of Code",
      summary:
        "Learn to read any function and predict how its time and memory grow with input size, and when that prediction stops being useful.",
      minutes: 35,
      keyTakeaways: [
        "Big-O describes how work grows as input grows; constants and smaller terms are dropped, so it predicts shape, not exact time.",
        "Sequential steps add and nested steps multiply; array methods like find, includes, and filter inside a loop are hidden nested loops.",
        "Spreading an accumulator inside reduce copies it every iteration and turns linear code into O(n^2).",
        "Spending O(n) memory on a lookup structure to avoid O(n^2) time is almost always the right trade at ERP scale.",
        "Amortized O(1) operations like push and Map.set are cheap on average but occasionally resize, which can surface as latency spikes.",
        "Big-O ignores I/O: count database and network round trips separately, because each costs a million times more than an in-memory operation.",
      ],
      quiz: [
        {
          question:
            "A reconciliation function loops over 30,000 invoices and, for each one, calls payments.find(p => p.invoiceId === inv.id) on an array of 30,000 payments. What is its time complexity, and roughly how many comparisons does it do in the worst case?",
          options: [
            "O(n), about 30,000 comparisons, because there is only one visible loop",
            "O(n log n), about 450,000 comparisons, because find stops early",
            "O(n^2), up to about 900,000,000 comparisons, because find is a loop inside the map",
            "O(1), because find uses an internal index",
          ],
          answer: 2,
          explanation:
            "Array.find scans linearly, so calling it once per invoice is a loop inside a loop: O(n * m), which is O(n^2) when both sides are the same size. Stopping early only helps the average case by a constant factor; it does not change the growth rate. JavaScript arrays have no internal index for property values.",
        },
        {
          question:
            "Your report builder groups invoices with reduce((acc, inv) => ({ ...acc, [inv.customerId]: [...(acc[inv.customerId] ?? []), inv] }), {}). It is fast in tests but slow with 50,000 invoices. Why?",
          options: [
            "Each iteration copies the entire accumulator object, so the total work is quadratic",
            "Object property access is O(n) in V8",
            "reduce is slower than for loops by a large constant factor",
            "The nullish coalescing operator forces deoptimization",
          ],
          answer: 0,
          explanation:
            "Spreading acc creates a new object containing every key so far, on every iteration. Copying k keys n times is O(n^2). Mutating a local Map or object you own inside the function is O(n). The reduce itself and the ?? operator are not the problem.",
        },
        {
          question:
            "An endpoint loops over 40 orders and awaits one 4 ms database query per order. A colleague proposes replacing an O(n log n) in-memory sort of those 40 orders with a faster algorithm. What should you focus on instead?",
          options: [
            "Nothing; O(n log n) is the bottleneck because it is worse than O(n)",
            "Converting the orders array to a Set before sorting",
            "Switching from TimSort to quicksort for better average performance",
            "The 40 sequential round trips, which cost about 160 ms, versus microseconds for sorting 40 items",
          ],
          answer: 3,
          explanation:
            "Big-O counts operations but ignores their cost. Forty sequential queries at 4 ms each dominate completely; sorting 40 items in memory takes microseconds. Count round trips separately from CPU work and fix the I/O shape first (batch or join).",
        },
        {
          question:
            "You need to check whether a status string is one of 'draft', 'sent', 'paid', 'void'. A reviewer insists you replace the array includes with a Set for O(1) lookup. What is the most accurate response?",
          options: [
            "Agree: O(1) is always faster than O(n)",
            "For a fixed 4-element list, n never grows, so the difference is negligible and either is fine",
            "Disagree: Sets are slower than arrays for all sizes",
            "Use a binary search instead, since O(log n) is the best compromise",
          ],
          answer: 1,
          explanation:
            "Big-O describes growth as n increases. If n is fixed and tiny, constants dominate and a 4-element scan can be as fast as hashing. Choose for readability. The Set becomes the right call when the collection is built from data that can grow.",
        },
        {
          question:
            "An export job loads 5 million ledger rows into an array, maps them to CSV lines, then writes the file. It crashes with a heap out-of-memory error. Which change addresses the actual complexity problem?",
          options: [
            "Stream rows with a database cursor and write each batch as it arrives, making extra memory O(1) instead of O(n)",
            "Replace map with a for loop to reduce time complexity",
            "Sort the rows first so the CSV writer can process them faster",
            "Store rows in a Map instead of an array",
          ],
          answer: 0,
          explanation:
            "The issue is space complexity: holding all n rows (and then n strings) in memory. Streaming with a cursor keeps a fixed-size buffer regardless of total rows. A for loop, sorting, or a Map all still hold every row in memory.",
        },
      ],
      resources: [
        { label: "Big-O Cheat Sheet", url: "https://www.bigocheatsheet.com/", kind: "web" },
        {
          label: "A Common-Sense Guide to Data Structures and Algorithms (Jay Wengrow)",
          url: "https://pragprog.com/titles/jwdsal2/a-common-sense-guide-to-data-structures-and-algorithms-second-edition/",
          kind: "book",
        },
        { label: "NeetCode: Courses and Concepts", url: "https://neetcode.io/courses", kind: "interactive" },
      ],
    },
    {
      slug: "arrays-vs-hash-maps",
      title: "Arrays vs Hash Maps (and Sets)",
      summary:
        "Turn nested lookups into single passes by indexing data into Maps and Sets, and learn the JavaScript-specific details that make or break it.",
      minutes: 35,
      keyTakeaways: [
        "Arrays are for order and position; Maps and Sets are for answering 'do I have key X?' many times.",
        "Index once, look up many: build a Map of the searched collection before looping, turning O(n * m) into O(n + m).",
        "Prefer Map over plain objects for runtime lookup tables: any key type, no prototype collisions, O(1) size, and predictable insertion order.",
        "Key design matters: normalize strings, use primitive composite keys, and watch for number vs string ID mismatches.",
        "Group by, index by, count by key, stitch query results, and diff two lists are the five patterns you will use every week.",
        "Hash maps have no order by key, so range questions belong to sorted arrays or database B-tree indexes.",
      ],
      quiz: [
        {
          question:
            "A purchase-order import processes 8,000 CSV lines and calls products.find(p => p.sku === line.sku) against a 40,000-product catalog for each line. What is the best fix?",
          options: [
            "Build a Map from SKU to product once before the loop, then use map.get for each line",
            "Sort the CSV lines by SKU before processing",
            "Move the find call into a Promise.all so lookups run in parallel",
            "Build the Map inside the loop so it always reflects the latest catalog",
          ],
          answer: 0,
          explanation:
            "Building the Map once costs O(P), and each lookup is O(1), so total work is O(P + L) instead of O(P * L). Sorting only the lines does not help the catalog scan. Promise.all does not parallelize synchronous CPU work. Building the Map inside the loop is worse than the original.",
        },
        {
          question:
            "You count tag usage from a CSV with counts[tag] = (counts[tag] ?? 0) + 1 using a plain object. A row with the tag 'constructor' produces a garbage value. Why?",
          options: [
            "Plain objects cannot store more than 1,000 keys",
            "The ?? operator does not work with string keys",
            "'constructor' is inherited from Object.prototype, so counts[tag] is a function rather than undefined",
            "Object keys are sorted alphabetically, causing a collision",
          ],
          answer: 2,
          explanation:
            "A plain {} inherits properties like constructor and toString from its prototype. counts['constructor'] returns the Object function, which is not nullish, so the code adds 1 to a function. A Map, or Object.create(null), has no inherited keys.",
        },
        {
          question:
            "You build new Map(stockRows.map(r => [r.productId, r])) where productId comes from Postgres as a string, then look up with a product whose id is a JavaScript number. Lookups return undefined. What happened?",
          options: [
            "Maps only support string keys",
            "Map uses strict key equality, so 42 and '42' are different keys",
            "The Map was garbage collected before the lookup",
            "Map.get is asynchronous",
          ],
          answer: 1,
          explanation:
            "Map compares keys with SameValueZero, so the number 42 and the string '42' do not match. Bigint columns often arrive as strings from the pg driver. Normalize ID types on both sides before building and querying the Map.",
        },
        {
          question:
            "Inventory is tracked per warehouse and per product. Which key strategy works correctly for a Map lookup?",
          options: [
            "map.set({ warehouseId, productId }, qty) and map.get({ warehouseId, productId })",
            "Two separate Maps, one per warehouse ID and one per product ID",
            "map.set(warehouseId + productId, qty) with no delimiter",
            "map.set(warehouseId + '|' + productId, qty), assuming IDs never contain the | character",
          ],
          answer: 3,
          explanation:
            "Object keys are compared by reference, so a freshly created object never matches. Concatenating without a delimiter can collide (W1 + 23 equals W12 + 3). A delimited string key that cannot appear inside the IDs, or JSON.stringify of a tuple, is reliable.",
        },
        {
          question:
            "A finance screen asks for all transactions between March 1 and March 15 from an in-memory list of 200,000 transactions. Why is a hash map keyed by date a poor fit?",
          options: [
            "Hash maps cannot store Date objects",
            "Hash maps have no ordering by key, so a range query still has to examine every key",
            "Hash maps are limited to 65,536 entries",
            "Hash lookups are O(n) for date keys",
          ],
          answer: 1,
          explanation:
            "Hashing scatters keys, so there is no way to jump to 'everything between A and B'. Range questions need sorted data: a sorted array with binary search, or a B-tree index in the database.",
        },
      ],
      resources: [
        { label: "NeetCode Roadmap: Arrays & Hashing", url: "https://neetcode.io/roadmap", kind: "interactive" },
        {
          label: "MDN: Map (including Map vs Object comparison)",
          url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map",
          kind: "docs",
        },
        {
          label: "A Common-Sense Guide to Data Structures and Algorithms (Jay Wengrow)",
          url: "https://pragprog.com/titles/jwdsal2/a-common-sense-guide-to-data-structures-and-algorithms-second-edition/",
          kind: "book",
        },
      ],
    },
    {
      slug: "practical-dsa-toolkit",
      title: "Beyond the Basics: The Practical DSA Toolkit",
      summary:
        "The sorting, searching, stack, queue, tree, and heap knowledge that actually shows up in SaaS and ERP code, mapped to the NeetCode patterns worth practicing.",
      minutes: 40,
      keyTakeaways: [
        "Comparison sorting is O(n log n); precompute sort keys, always pass a numeric comparator, and push sorting into SQL with an index when you can.",
        "Binary search gives O(log n) range boundaries on sorted data and is the idea behind B-tree index lookups.",
        "array.shift() is O(n); using it as a queue in a loop is quadratic, so use a head pointer or a real queue.",
        "Build trees from flat parentId rows in O(n) with a Map, and fetch subtrees from Postgres with a recursive CTE instead of a query per level.",
        "A size-k heap finds the top k of n items in O(n log k) time and O(k) memory, which matters when streaming large result sets.",
        "NeetCode's Arrays & Hashing problems map directly onto deduplication, reconciliation, frequency counting, and gap detection in business data.",
      ],
      quiz: [
        {
          question:
            "A dashboard sorts 200,000 customer revenue rows in Node to show the top 10. The data comes from Postgres. What is the best improvement?",
          options: [
            "Switch to a faster sorting algorithm in JavaScript",
            "Sort with localeCompare for stability",
            "Use a Set to deduplicate rows before sorting",
            "Use ORDER BY revenue DESC LIMIT 10 in SQL, ideally backed by an index, so only 10 rows are read and returned",
          ],
          answer: 3,
          explanation:
            "Loading 200,000 rows to keep 10 wastes I/O, memory, and CPU. The database can return the top 10 directly, and with a suitable index it reads only those rows. If the data were already in memory and huge, a size-10 heap would beat a full sort.",
        },
        {
          question:
            "A background worker loads a backlog of 100,000 jobs into an array and processes them with while (jobs.length) process(jobs.shift()). It gets dramatically slower as the backlog grows. Why?",
          options: [
            "shift() is O(n) because it reindexes the remaining elements, so the loop is O(n^2)",
            "while loops are slower than for loops",
            "The array exceeds V8's maximum length",
            "shift() triggers a database round trip",
          ],
          answer: 0,
          explanation:
            "Removing from the front of an array moves every remaining element. Doing it n times costs about n^2 / 2 moves. Iterating with a head index, or using a proper queue structure, makes each dequeue O(1).",
        },
        {
          question:
            "You build a product category tree from 50,000 rows using recursion where each call does rows.filter(r => r.parentId === id). It takes seconds. What is the O(n) approach?",
          options: [
            "Sort rows by name first, then recurse",
            "Create a Map from id to node in one pass, then attach each node to its parent's children array in a second pass",
            "Run one database query per tree level",
            "Use JSON.parse(JSON.stringify(rows)) to clone before recursing",
          ],
          answer: 1,
          explanation:
            "Filtering all rows for each node is O(n^2). Indexing nodes by id and then doing a single pass to link children to parents is O(n). One query per level adds round trips and does not fix the in-memory cost.",
        },
        {
          question:
            "Exchange rates are stored in memory as an array sorted by effective date. For each of 100,000 transactions you need the most recent rate on or before the transaction date. Which approach is most efficient?",
          options: [
            "Use rates.filter(r => r.date <= tx.date).pop() for each transaction",
            "Put rates in a Map keyed by date and call get(tx.date)",
            "Binary search for the boundary position for each transaction, costing O(log r) per lookup",
            "Sort the rates again for each transaction",
          ],
          answer: 2,
          explanation:
            "This is a boundary question on sorted data, which is exactly what binary search (lower bound) answers in O(log r). Filtering is O(r) per transaction. A Map only finds exact date matches, not 'most recent on or before'.",
        },
        {
          question:
            "Several countries require sequential invoice numbering without gaps, and auditors ask you to list missing numbers. Which NeetCode Arrays & Hashing pattern does this most closely use?",
          options: [
            "Two Sum: a map of complement values",
            "Longest Consecutive Sequence: a Set of present values checked for neighbors",
            "Product of Array Except Self: prefix and suffix products",
            "Group Anagrams: grouping by a sorted key",
          ],
          answer: 1,
          explanation:
            "Put all present numbers in a Set, then check which values in the range are missing, the same membership-and-neighbor idea used in Longest Consecutive Sequence. Two Sum fits matching amounts, Group Anagrams fits normalization-based grouping, and prefix products fit running totals.",
        },
      ],
      resources: [
        { label: "NeetCode Roadmap", url: "https://neetcode.io/roadmap", kind: "interactive" },
        { label: "Big-O Cheat Sheet (data structure and sorting costs)", url: "https://www.bigocheatsheet.com/", kind: "web" },
        {
          label: "PostgreSQL Docs: WITH queries and recursive CTEs",
          url: "https://www.postgresql.org/docs/current/queries-with.html",
          kind: "docs",
        },
        {
          label: "A Common-Sense Guide to Data Structures and Algorithms (Jay Wengrow)",
          url: "https://pragprog.com/titles/jwdsal2/a-common-sense-guide-to-data-structures-and-algorithms-second-edition/",
          kind: "book",
        },
      ],
    },
    {
      slug: "database-indexing",
      title: "Database Indexing: B-Trees, Plans, and Column Order",
      summary:
        "Understand how Postgres B-tree indexes work, read EXPLAIN ANALYZE output with confidence, and design composite, covering, and partial indexes for real query shapes.",
      minutes: 45,
      keyTakeaways: [
        "Without an index, Postgres must sequentially scan the heap; a B-tree turns a lookup into 3 or 4 page reads and returns rows in sorted order.",
        "Read EXPLAIN (ANALYZE, BUFFERS) inside-out: compare estimated vs actual rows, look for Rows Removed by Filter, Sort nodes, and buffers read.",
        "Composite index order matters: equality columns first, then the range or ORDER BY column; tenant_id usually leads in multi-tenant SaaS.",
        "Covering indexes with INCLUDE enable Index Only Scans; partial indexes shrink the index to the subset of rows your queries actually touch.",
        "Every index adds write cost to inserts and updates, so remove unused indexes and design one composite per hot query shape rather than one per column.",
        "Functions on columns, leading wildcards, type mismatches, and stale statistics are the usual reasons an index is ignored.",
      ],
      quiz: [
        {
          question:
            "The query WHERE tenant_id = $1 AND status = 'overdue' ORDER BY issued_at DESC LIMIT 50 is slow. Which index best serves it?",
          options: [
            "(issued_at, tenant_id, status)",
            "(status) and a separate index on (tenant_id)",
            "(tenant_id, status, issued_at DESC)",
            "(tenant_id, issued_at, status)",
          ],
          answer: 2,
          explanation:
            "The two equality columns come first, so Postgres can jump straight to the tenant and status, then read rows already ordered by issued_at and stop after 50. Leading with issued_at cannot narrow by tenant. Separate single-column indexes cannot provide the order. Putting issued_at before status forces scanning the tenant's entire date range and filtering by status.",
        },
        {
          question:
            "An EXPLAIN ANALYZE shows: Seq Scan on invoices (rows=31877) with Rows Removed by Filter: 2968123, and Buffers: shared read=61210. What does this tell you?",
          options: [
            "Postgres read about 3 million rows and roughly 478 MB from disk to keep about 1% of them, so a suitable index would likely help a lot",
            "The query is efficient because it returned 31,877 rows",
            "The cost numbers are in milliseconds and show the query took 61 seconds",
            "The table needs to be vacuumed because rows were removed",
          ],
          answer: 0,
          explanation:
            "Rows Removed by Filter is wasted work: nearly all rows were read and discarded. 61,210 buffers of 8 KB is about 478 MB read from disk. 'Removed by filter' refers to filtering, not deletion, and buffers are pages, not milliseconds.",
        },
        {
          question:
            "You have an index on customers(email), but WHERE lower(email) = lower($1) still uses a Seq Scan. What is the fix?",
          options: [
            "Run VACUUM FULL on the table",
            "Increase work_mem",
            "Add email to an INCLUDE clause",
            "Create an expression index on lower(email)",
          ],
          answer: 3,
          explanation:
            "The index stores raw email values, but the query compares lower(email), which is a different expression. An expression index on lower(email) stores exactly what the query searches for. Vacuuming, INCLUDE columns, and memory settings do not change which expression is indexed.",
        },
        {
          question:
            "88% of invoices are 'paid'. The 'Needs attention' screen only queries status IN ('sent', 'overdue') by tenant and due date. What index design fits best?",
          options: [
            "A full index on (status)",
            "A partial index on (tenant_id, due_date) WHERE status IN ('sent', 'overdue')",
            "A hash index on (tenant_id)",
            "No index, since status has low selectivity",
          ],
          answer: 1,
          explanation:
            "A partial index contains only the roughly 10% of rows the screen ever looks at, so it is smaller, faster, and not updated for paid invoices that never appear there. The query must include the same predicate for the planner to use it. A status-only index cannot serve the tenant and date ordering.",
        },
        {
          question:
            "After adding 11 indexes to the transactions table over two years, bulk imports have become noticeably slower. What is the most likely explanation and next step?",
          options: [
            "Indexes have no write cost; investigate network latency instead",
            "Postgres limits tables to 10 indexes and is falling back to slow mode",
            "Each insert must update every index; check pg_stat_user_indexes for indexes with zero scans and remove or consolidate them",
            "Indexes only slow down SELECT queries",
          ],
          answer: 2,
          explanation:
            "Every index is an additional structure to maintain on insert and on updates to indexed columns. pg_stat_user_indexes shows idx_scan counts; indexes that are never used, or are redundant with a composite, are pure cost. Check across replicas and a full business cycle before dropping.",
        },
      ],
      resources: [
        { label: "Use The Index, Luke: SQL indexing and tuning", url: "https://use-the-index-luke.com/", kind: "web" },
        {
          label: "PostgreSQL Docs: Using EXPLAIN",
          url: "https://www.postgresql.org/docs/current/using-explain.html",
          kind: "docs",
        },
        {
          label: "PostgreSQL Docs: Indexes (multicolumn, partial, index-only scans)",
          url: "https://www.postgresql.org/docs/current/indexes.html",
          kind: "docs",
        },
      ],
    },
    {
      slug: "n-plus-one-query-trap",
      title: "The N+1 Query Trap",
      summary:
        "Recognize when ORM code fires one query per row, make it visible with query logging, and fix it with JOINs, eager loading, batched IN queries, or DataLoader.",
      minutes: 35,
      keyTakeaways: [
        "N+1 means one query for a list plus one per item; the cost is round trips, not slow SQL, so it gets worse with network distance.",
        "It hides in lazy relations, loops with await, serializers, and GraphQL resolvers; Promise.all parallelizes it but does not remove it.",
        "Turn on ORM query logging and add a per-request query counter with AsyncLocalStorage to catch regressions early.",
        "Fix with a JOIN for many-to-one data, eager loading in the ORM, or a batched WHERE id = ANY(...) query stitched with a Map.",
        "DataLoader batches loads made in the same tick; create loaders per request and return results in key order.",
        "Avoid the opposite problem: giant JOINs across multiple one-to-many relations cause row explosion, so load those separately.",
      ],
      quiz: [
        {
          question:
            "An invoice list endpoint takes 60 ms locally but 900 ms in production, and no individual query exceeds 2 ms. Query logs show 151 queries per request. What is the most likely cause?",
          options: [
            "Missing indexes on the invoices table",
            "An N+1 pattern multiplying network round trips, which matter more with production latency",
            "Postgres is under-provisioned and needs more CPU",
            "JSON serialization of 50 invoices is slow",
          ],
          answer: 1,
          explanation:
            "Fast individual queries plus a high query count is the signature of N+1. Locally the round trip is nearly free; in production each one adds a few milliseconds of network and pool overhead, and 150 of them add up. Missing indexes would show up as individually slow queries.",
        },
        {
          question:
            "A developer replaces a for loop that awaits one customer query per invoice with Promise.all(invoices.map(...)). Latency drops. What problem remains?",
          options: [
            "None; Promise.all fixes N+1",
            "The results come back in random order",
            "Promise.all runs queries sequentially anyway",
            "It still fires N queries and can grab up to N pool connections at once, starving other requests under load",
          ],
          answer: 3,
          explanation:
            "Promise.all makes the queries concurrent, so wall time drops, but the database still handles N queries and the pool hands out many connections to one request. Under load this exhausts the pool. The query count should be constant, not proportional to N.",
        },
        {
          question:
            "A DataLoader batch function runs SELECT * FROM customers WHERE id = ANY($1) and returns rows directly. Occasionally invoices show the wrong customer. Why?",
          options: [
            "DataLoader requires results to be returned in the same order and length as the input keys, but the database does not guarantee order",
            "ANY is not supported for uuid arrays",
            "DataLoader caches results for 24 hours by default",
            "The batch function must be synchronous",
          ],
          answer: 0,
          explanation:
            "DataLoader matches results to keys by position. The database can return rows in any order and omits missing IDs, so you must build a Map from the rows and return ids.map(id => map.get(id) ?? null).",
        },
        {
          question: "Why should DataLoader instances be created per request rather than once globally?",
          options: [
            "Global instances are not allowed by Node",
            "Per-request instances batch across multiple users for better efficiency",
            "DataLoader caches loaded values; a global instance serves stale data and can leak one tenant's or user's data to another",
            "Global instances cannot batch",
          ],
          answer: 2,
          explanation:
            "DataLoader memoizes by key for its lifetime. Scoped to a request, that is a useful deduplication. Scoped globally, it becomes an unbounded cache with no invalidation and no permission boundaries.",
        },
        {
          question:
            "You eagerly load invoices with both their line items (about 20 each) and payments (about 3 each) in one JOIN for 50 invoices. The result set is surprisingly large. What happened?",
          options: [
            "The JOIN produced a cartesian product per invoice: about 50 x 20 x 3 = 3,000 rows with heavily duplicated data",
            "Postgres ignores LIMIT when JOINs are present",
            "Eager loading always returns the entire table",
            "Line items were loaded twice due to a cache miss",
          ],
          answer: 0,
          explanation:
            "Joining two independent one-to-many relations multiplies rows. Load each one-to-many relation in its own batched query (constant query count) instead of one giant JOIN.",
        },
      ],
      resources: [
        {
          label: "Prisma Docs: Query optimization and the N+1 problem",
          url: "https://www.prisma.io/docs/orm/prisma-client/queries/query-optimization-performance",
          kind: "docs",
        },
        { label: "DataLoader (GraphQL) on GitHub", url: "https://github.com/graphql/dataloader", kind: "docs" },
        {
          label: "Use The Index, Luke: Join operations",
          url: "https://use-the-index-luke.com/sql/join",
          kind: "web",
        },
      ],
    },
    {
      slug: "measuring-performance",
      title: "Measuring Performance: Benchmarks, Profiles, Percentiles, Pagination",
      summary:
        "Measure before and after with benchmarks that are not fooled by the JIT, find bottlenecks with profilers, report latency as percentiles, and fix deep pagination with keyset cursors.",
      minutes: 40,
      keyTakeaways: [
        "Measure a baseline before changing code, change one thing at a time, and always record the conditions (data size, machine, warm or cold).",
        "Use performance.now() with warm-up runs, many samples, and a result sink; report distributions, not single numbers, across several input sizes.",
        "CPU profiles and flame graphs show where JavaScript time goes; if the profile is small but the request is slow, the time is in I/O.",
        "pg_stat_statements sorted by total time shows which query shapes cost the most overall.",
        "Use p50, p95, and p99 instead of averages; tails are where incidents and your largest tenants live, and percentiles must never be averaged.",
        "Offset pagination costs O(offset + limit) and shifts under inserts; keyset pagination on a unique sort with a matching index costs the same on every page.",
      ],
      quiz: [
        {
          question:
            "A benchmark calls a function once, times it with Date.now(), and reports 12 ms before and 3 ms after a refactor. What is the biggest problem with this result?",
          options: [
            "A single cold run includes JIT warm-up and noise, so the comparison is not reliable",
            "Date.now() is too precise",
            "Benchmarks should always be run in the browser",
            "3 ms is below the threshold where performance matters",
          ],
          answer: 0,
          explanation:
            "V8 optimizes functions after they run several times, and single runs are noisy from GC and scheduling. Use performance.now(), warm up first, take many samples, and compare medians and tails with the same inputs.",
        },
        {
          question:
            "A report endpoint takes 900 ms. A CPU profile of the request shows only 30 ms of JavaScript execution. Where should you look next?",
          options: [
            "Optimize the hottest function in the CPU profile",
            "Upgrade to a faster CPU",
            "I/O waits: database queries, external HTTP calls, or a blocked event loop, using tracing spans and pg_stat_statements",
            "Rewrite the endpoint in a compiled language",
          ],
          answer: 2,
          explanation:
            "CPU profiles only show time spent running JavaScript. The remaining 870 ms is waiting. Tracing spans around I/O and database statistics show which query or call is responsible.",
        },
        {
          question:
            "An endpoint has a 150 ms average latency, but support tickets say it is often painfully slow. Which metric best captures the problem?",
          options: [
            "The mean, recalculated hourly",
            "Requests per second",
            "The minimum latency",
            "p95 and p99 latency, ideally broken down per tenant",
          ],
          answer: 3,
          explanation:
            "Averages hide tails. A few multi-second requests barely move the mean but are exactly what users complain about. Percentiles show the tail, and per-tenant breakdowns reveal large customers who are consistently slow.",
        },
        {
          question:
            "A ledger API uses ORDER BY posted_at DESC LIMIT 50 OFFSET 200000. Page 1 is fast, page 4,000 takes 300 ms, even with an index on (tenant_id, posted_at). Why?",
          options: [
            "The index is corrupted for deep pages",
            "OFFSET still reads and discards all skipped rows, so cost grows with page depth",
            "LIMIT is ignored when OFFSET is present",
            "Postgres caches only the first page",
          ],
          answer: 1,
          explanation:
            "Postgres cannot jump to row 200,000 without walking past the preceding rows. Keyset pagination with WHERE (posted_at, id) < (cursor values) seeks directly to the position using the index, making every page cost roughly the same.",
        },
        {
          question:
            "You implement keyset pagination with WHERE posted_at < $cursor ORDER BY posted_at DESC. Users report occasionally missing transactions between pages. What is wrong?",
          options: [
            "Keyset pagination cannot work with timestamps",
            "The LIMIT should be an odd number",
            "posted_at is not unique; rows sharing the boundary timestamp are skipped, so add id as a tiebreaker in the sort, cursor, and index",
            "The cursor must be base64 encoded to work correctly",
          ],
          answer: 2,
          explanation:
            "If several rows share the last timestamp on a page, a strict < comparison skips the ones not returned yet. Make the sort unique with (posted_at, id), compare with a row value (posted_at, id) < ($1, $2), and index both columns in that order.",
        },
      ],
      resources: [
        {
          label: "Node.js Docs: Profiling Node.js applications",
          url: "https://nodejs.org/en/learn/getting-started/profiling",
          kind: "docs",
        },
        {
          label: "Use The Index, Luke: Paging through results (keyset pagination)",
          url: "https://use-the-index-luke.com/no-offset",
          kind: "web",
        },
        {
          label: "PostgreSQL Docs: pg_stat_statements",
          url: "https://www.postgresql.org/docs/current/pgstatstatements.html",
          kind: "docs",
        },
      ],
    },
  ],
  problems: [
    {
      slug: "hash-map-shift",
      title: "The Hash Map Shift",
      kind: "exercise",
      summary:
        "Match 10,000 products against 10,000 inventory counts with nested loops, then refactor to a hash map and prove the O(n^2) to O(n) improvement with real benchmarks.",
      estimatedHours: 4,
      needsDiagram: false,
      requirements: [
        "matchNested and matchWithMap produce deeply equal output (same lines, same order) for n = 1,000, 5,000, 10,000, verified by an automated check before any timing.",
        "matchWithMap builds the inventory Map exactly once, outside the product loop, and contains no nested loop over the data.",
        "At n = 10,000, matchWithMap's median runtime is at least 100x faster than matchNested's median.",
        "The benchmark uses performance.now(), at least 5 warm-up runs, and at least 10 timed runs for the Map version, and reports median and p95 for each n.",
        "Doubling n from 5,000 to 10,000 shows roughly 4x growth for the nested version and roughly 2x for the Map version, with any deviation explained in the README.",
        "The orphan report lists counts with unknown product IDs and products with no count, runs in O(n), and its totals match the generator's 2% and 1% injection rates.",
        "The multi-warehouse extension produces correct total on-hand per product when each product has 1 to 3 warehouse counts.",
      ],
      hints: [
        "Look at where the inner loop is: it searches the counts array once per product. What single structure would answer 'what is the count for product X?' without searching?",
        "Build a Map<string, InventoryCount> keyed by productId in one pass over counts, before you loop over products.",
        "For orphans, you need two membership questions: a Set of product IDs (to check counts) and the counts Map you already have (to check products).",
        "For multiple warehouses, summing into a Map<string, number> with map.set(id, (map.get(id) ?? 0) + c.onHand) avoids keeping arrays you never read.",
        "If your timings jump around, make sure data generation is outside the timed section, keep the result in a variable the benchmark reads, and run with no other heavy apps open.",
      ],
      rubric: [
        "Can I explain, without notes, why the nested version is O(n^2) and the Map version is O(n), including the cost of building the Map?",
        "Do my benchmark numbers actually show the predicted growth curve, and have I explained any anomalies honestly?",
        "Did I verify correctness on messy data (missing counts and orphans) before celebrating the speedup?",
        "Is the Map version as readable as the original, with clear naming and no clever tricks?",
        "Would someone else get the same numbers by following my README on their machine?",
      ],
      stretchGoals: [
        "Implement a third approach that sorts both arrays by productId and merges them with two pointers, and compare its O(n log n) cost to the Map version.",
        "Measure peak heap usage (process.memoryUsage().heapUsed) for each approach at n = 100,000 and discuss the time-memory trade-off.",
        "Load the products from a real Postgres table and the counts from a CSV file, and measure where end-to-end time actually goes.",
      ],
      repoChecklist: [
        "README with setup and how to run the correctness check and the benchmark (npm run bench).",
        "Before/after benchmark results table for every n, with machine specs and Node version.",
        "The seeded data generator, so results are reproducible.",
        "Separate source files for matchNested, matchWithMap, and the orphan report.",
        "A short written explanation of the complexity of each approach and the observed growth curve.",
      ],
      relatedLessons: ["big-o-notation", "arrays-vs-hash-maps", "measuring-performance"],
    },
    {
      slug: "query-monitor",
      title: "The Query Monitor",
      kind: "exercise",
      summary:
        "Log raw SQL for an invoice list endpoint, prove it fires 101 queries for 50 invoices, and rewrite it with JOINs, eager loading, and batching to a constant query count.",
      estimatedHours: 6,
      needsDiagram: false,
      requirements: [
        "The naive /invoices route is shown, via captured query logs, to execute 101 queries for 50 invoices.",
        "Every response includes an X-Query-Count header produced by an AsyncLocalStorage-based per-request counter, and requests over 10 queries log a warning.",
        "The /invoices/join route executes exactly 1 query, /invoices/eager at most 3, and /invoices/batched exactly 3.",
        "All fixed routes return JSON deeply equal to the naive route's output for the same tenant, verified by an automated test.",
        "With 5 ms simulated latency per query, the naive route's p50 is at least 10x the JOIN route's p50, measured over 200 requests at 10 concurrent connections.",
        "The list query uses an index on invoices (tenant_id, issued_at DESC), confirmed by an EXPLAIN ANALYZE excerpt showing an Index Scan rather than a Seq Scan.",
        "A regression test fails if any fixed route exceeds 3 queries.",
      ],
      hints: [
        "Start by logging. Count the queries for one request before changing any code, and look at which lines repeat.",
        "The repeated queries all have the shape 'fetch one row by customer id'. What single query could fetch all of them at once?",
        "For the batched route: collect unique customer IDs into a Set, run one WHERE id = ANY($1) query, and stitch with a Map. Do the same for billing addresses keyed by customer_id.",
        "For the JOIN route, join invoices to customers on customer_id and to addresses on customer_id with kind = 'billing' in the ON clause, so invoices without an address are not dropped if you use a LEFT JOIN.",
        "For the query counter, store a mutable { count } object in AsyncLocalStorage at the start of each request and increment it from your ORM's query event or a wrapped pool.query.",
      ],
      rubric: [
        "Can I point to the exact log lines that prove the N+1 pattern and the exact lines that prove it is gone?",
        "Did I measure with simulated network latency, not just on localhost where round trips are nearly free?",
        "Are my fixed routes returning identical data, including customers with missing billing addresses?",
        "Would my regression test actually catch someone adding a lazy relation access later?",
        "Can I explain when I would choose a JOIN, eager loading, batched IN queries, or DataLoader?",
      ],
      stretchGoals: [
        "Add a GraphQL endpoint with a Customer field resolver, demonstrate N+1, and fix it with a per-request DataLoader.",
        "Add a Promise.all variant, set the pool size to 10, and measure its effect on other concurrent requests under load.",
        "Include invoice line items in the response and compare one large JOIN against separate batched queries by rows returned and latency.",
        "Export a trace with OpenTelemetry and include a screenshot of the N+1 staircase versus the fixed waterfall.",
      ],
      repoChecklist: [
        "README with Docker setup, seed command, how to run the server, and how to run the benchmark and tests.",
        "Before/after results table: query count and p50/p95 latency per route, with and without simulated latency.",
        "Raw query log excerpts for the naive route and the JOIN route.",
        "The seed script, schema migration, and index definitions.",
        "The query-count middleware and the regression test.",
      ],
      relatedLessons: ["n-plus-one-query-trap", "arrays-vs-hash-maps", "database-indexing", "measuring-performance"],
    },
    {
      slug: "erp-reporting-index-strategy",
      title: "Design: Index Strategy for an ERP Reporting Screen",
      kind: "design",
      summary:
        "Design the indexes, query shapes, and access paths for a month-end Sales & Receivables screen over 40 million invoices, and justify every choice against its write cost.",
      estimatedHours: 5,
      needsDiagram: true,
      designPrompt:
        "Draw the four tables (customers, products, invoices, invoice_lines) with their keys and cardinalities, and mark the tenant boundary. Next to each table, list every index you propose with exact column order, sort direction, INCLUDE columns, and partial predicates. Then draw the access path for each of the three queries (overdue list, revenue by month, top products) as a flow: which index is entered, what scan type is used, how tables are joined, where grouping or sorting happens, and where LIMIT stops the work. Annotate each path with the expected rows read.",
      requirements: [
        "The diagram shows all four tables with primary keys, foreign keys, one-to-many cardinalities, and tenant_id on every table.",
        "No more than 4 new indexes on invoices and 2 on invoice_lines, each annotated with the query it serves; every tenant-scoped index leads with tenant_id.",
        "Each of the three queries has written SQL and a drawn access path naming the expected scan type (Index Scan, Index Only Scan, Bitmap, or Seq Scan) and join strategy (Nested Loop, Hash Join, or Merge Join).",
        "The overdue list uses keyset pagination with a unique cursor on (due_date, id), and the design explains why page 200 costs about the same as page 1.",
        "Each query has a numeric latency target (for example overdue list under 5 ms, revenue by month under 150 ms, top products under 500 ms) and an estimated rows-read count.",
        "The write-cost section lists how many indexes each table carries after the change and which are touched by invoice creation, a status change to paid, and an open_cents update.",
        "A fallback design (pre-aggregated table or materialized view) is given for at least one reporting query, with its freshness trade-off stated.",
      ],
      hints: [
        "Start from the queries, not the tables. Write the exact WHERE and ORDER BY for each panel, then design an index per query shape.",
        "For the overdue list, only about 10% of invoices are sent or overdue. Consider a partial index so paid invoices never touch it.",
        "For revenue by month, think about which columns the query reads. Could INCLUDE let it avoid visiting the heap entirely?",
        "Top products needs invoice lines filtered by date, but the date lives on invoices. Consider whether denormalizing issued_at onto invoice_lines, or indexing invoice_lines (tenant_id, invoice_id), produces the cheaper path, and say what each costs.",
        "Check the existing invoices (customer_id) index: is it covered by one of your composite indexes for every query that uses it, or is it still needed for foreign key checks and customer detail pages?",
      ],
      rubric: [
        "Could another engineer implement my indexes as a migration directly from the document, with no ambiguity about column order?",
        "Does every index trace back to a specific query, and does every query trace to a specific index?",
        "Have I been honest about write cost and about which status changes cause index updates?",
        "Did I state what evidence (an EXPLAIN plan, a metric) would prove my design wrong?",
        "Is the diagram readable without the text, with access paths clearly distinguishable from table relationships?",
      ],
      stretchGoals: [
        "Seed a scaled-down dataset (400,000 invoices, 2.8 million lines), apply your indexes, and annotate the diagram with real EXPLAIN (ANALYZE, BUFFERS) numbers.",
        "Design a monthly_revenue summary table maintained on payment, including how you would backfill it and keep it correct under refunds.",
        "Evaluate whether partitioning invoices by issued_at range would help any of the three queries, and what it would cost.",
      ],
      repoChecklist: [
        "README summarizing the design, with how to run the optional seed and EXPLAIN scripts.",
        "Exported diagram image (ERD plus access paths) committed to the repo.",
        "A migration file containing the exact CREATE INDEX CONCURRENTLY statements proposed.",
        "Before/after EXPLAIN (ANALYZE, BUFFERS) excerpts for each query if you ran the scaled-down benchmark, or predicted plans clearly labeled as predictions if you did not.",
      ],
      relatedLessons: ["database-indexing", "measuring-performance", "n-plus-one-query-trap"],
    },
    {
      slug: "million-row-data-engine",
      title: "The 1-Million-Row Data Engine",
      kind: "capstone",
      summary:
        "Seed 1,000,000 financial transactions, build a filtered and paginated ledger API, and optimize it with composite indexes, keyset pagination, and careful in-memory work until core queries run in under a millisecond.",
      estimatedHours: 16,
      needsDiagram: false,
      requirements: [
        "The seed script inserts exactly 1,000,000 transactions with the specified tenant skew, reproducibly from a fixed seed, and finishes in under 2 minutes using COPY or batched multi-row inserts.",
        "GET /tenants/:tenantId/transactions supports accountId, from, to, status, category, minAmount, limit (max 200), and an opaque keyset cursor, ordered by posted_at DESC, id DESC.",
        "The optimized version uses at most 4 secondary indexes on transactions, each justified in the README and shown in use by at least one saved EXPLAIN (ANALYZE, BUFFERS) plan.",
        "Q1, Q2, Q3, and Q5 run in under 1 ms of database execution time at p50; Q4 under 5 ms; Q6 (summary) under 50 ms, measured over 200 runs each.",
        "Page 200 (Q2) in the optimized version is within 2x of page 1's latency, while the naive OFFSET version shows at least 20x degradation.",
        "Full HTTP p95 for Q1 to Q5 is under 20 ms with 10 concurrent connections, measured with autocannon or k6.",
        "Account names are included without N+1 queries: each list request executes at most 2 queries.",
        "Index cost is documented: total index size from pg_indexes_size and the time to insert 50,000 additional rows with and without the indexes.",
      ],
      hints: [
        "Write down the six representative queries first and list the equality filters, range filters, and sort for each. Your indexes fall out of that list.",
        "Every query is scoped by tenant and sorted by (posted_at DESC, id DESC). An index starting with tenant_id and ending with posted_at DESC, id DESC serves the default list; ask which other equality filters deserve their own index.",
        "For minAmount, remember that a range filter after the sort columns cannot narrow the index scan; check whether the planner filters rows as it walks the index and whether that is fast enough given LIMIT 50.",
        "For the summary endpoint, let SQL do the aggregation (SUM with FILTER, GROUP BY counterparty ORDER BY ... LIMIT 5) and confirm the plan; only pull rows into Node if you can justify it.",
        "If a plan shows estimated rows wildly different from actual rows, run ANALYZE and consider whether tenant skew is fooling the planner for tenant 1 versus tenant 37.",
      ],
      rubric: [
        "Does every index I created appear in at least one saved plan, and can I explain its column order?",
        "Are my latency numbers distributions measured with warm-up, with database time and HTTP time reported separately?",
        "Did I test both a huge tenant and a small tenant, and do both meet the targets?",
        "Is my cursor pagination correct under ties and under concurrent inserts, with a test proving no rows are skipped or duplicated?",
        "Could someone clone the repo and reproduce my before/after table by following the README?",
        "Have I been honest about the write and storage cost of my indexes?",
      ],
      stretchGoals: [
        "Add a free-text counterparty search using a pg_trgm GIN index and measure its cost and benefit.",
        "Partition transactions by month and compare plans and latency for Q3 and Q6.",
        "Add a streaming CSV export of a full tenant ledger using a server-side cursor, keeping Node heap usage flat regardless of row count.",
        "Scale to 10 million rows and report which targets still hold and which break.",
      ],
      repoChecklist: [
        "README with Docker/Postgres setup, how to seed, how to run the API, and how to run npm run bench.",
        "Before/after results table for all six representative queries (p50, p95, p99 for database and HTTP), with machine specs and Postgres version.",
        "A plans/ folder with EXPLAIN (ANALYZE, BUFFERS) output for each query before and after optimization.",
        "Migration files for schema and indexes, plus the seed script with its fixed random seed.",
        "A section justifying each index's column order and documenting its write and storage cost.",
        "Tests for cursor pagination correctness (no skipped or duplicated rows across pages).",
      ],
      relatedLessons: [
        "big-o-notation",
        "practical-dsa-toolkit",
        "database-indexing",
        "n-plus-one-query-trap",
        "measuring-performance",
      ],
    },
  ],
  sources: [
    {
      label: "A Common-Sense Guide to Data Structures and Algorithms (Jay Wengrow)",
      url: "https://pragprog.com/titles/jwdsal2/a-common-sense-guide-to-data-structures-and-algorithms-second-edition/",
      kind: "book",
    },
    {
      label: "NeetCode.io (Concepts and Arrays & Hashing tracks)",
      url: "https://neetcode.io",
      kind: "interactive",
    },
  ],
};
