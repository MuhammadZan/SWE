## Why this matters

A teammate "optimizes" the monthly statement generator by replacing a `for` loop with a clever reduce, posts a screenshot showing it went from 12 ms to 3 ms, and merges it. Production gets no faster. It turns out the first run included JIT warm-up, the second ran with warm caches, the real bottleneck was a database query taking 900 ms, and the "optimized" code was slightly slower once V8 had optimized both versions.

Performance work without careful measurement is guessing with extra steps. This lesson covers how to measure correctly: benchmarking that is not fooled by the JIT, profiling to find where time actually goes, reading latency as percentiles instead of averages, and the most common real-world fix for slow list endpoints: switching from offset to keyset pagination.

## The measurement mindset

Three rules before any optimization:

1. **Measure before changing anything.** Write down a baseline number with the exact conditions (data size, machine, warm or cold).
2. **Find the bottleneck, do not assume it.** In web apps, it is usually I/O (queries, network) and rarely the loop you are staring at.
3. **Change one thing, measure again.** If you change three things, you do not know which one helped (or which one hurt).

## Benchmarking correctly in Node

### The naive benchmark and why it lies

```ts
const start = Date.now();
matchInventory(products, stock);
console.log(Date.now() - start, "ms");
```

Problems:

- **`Date.now()` has millisecond resolution** and can jump with clock adjustments. Use `performance.now()` (sub-millisecond, monotonic) or `process.hrtime.bigint()`.
- **One run is noise.** GC pauses, other processes, CPU frequency scaling all affect a single sample.
- **JIT warm-up.** V8 first interprets your function, then compiles an optimized version after it has run enough times. The first runs are slower and not representative of a long-running server.
- **Dead code elimination.** If the result is unused, the optimizer may skip work entirely, producing impossibly fast numbers.

### A better hand-rolled benchmark

```ts
import { performance } from "node:perf_hooks";

function bench(name: string, fn: () => unknown, { warmup = 20, runs = 100 } = {}) {
  let sink: unknown;
  for (let i = 0; i < warmup; i++) sink = fn(); // let the JIT optimize

  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    sink = fn();
    samples.push(performance.now() - t0);
  }
  if (sink === Symbol.for("never")) console.log(sink); // keep result alive

  samples.sort((a, b) => a - b);
  const pct = (p: number) => samples[Math.min(samples.length - 1, Math.floor((p / 100) * samples.length))];
  console.log(
    `${name}: p50=${pct(50).toFixed(3)}ms p95=${pct(95).toFixed(3)}ms p99=${pct(99).toFixed(3)}ms min=${samples[0].toFixed(3)}ms`,
  );
}

const products = generateProducts(10_000);
const stock = generateStock(10_000);
bench("nested loops", () => matchNested(products, stock), { runs: 10 });
bench("hash map", () => matchWithMap(products, stock));
```

Checklist:

- **Generate input outside the timed section.** Do not time your data generator.
- **Use the same input for both versions**, ideally with a fixed random seed so runs are reproducible.
- **Report a distribution** (median and tail), not one number.
- **Run on a quiet machine** with the same Node version you deploy.
- **Test multiple sizes** (1k, 10k, 100k) to see the growth curve, not just a single point. This is how you confirm Big-O empirically.

For serious micro-benchmarks, use a library such as `tinybench` or `mitata`, which handle warm-up, statistics, and outliers.

### Benchmark the right layer

A micro-benchmark of a function tells you about that function. It does not tell you whether the endpoint is faster. For endpoints, use a load tool such as `autocannon` (Node) or `k6`:

```bash
npx autocannon -c 20 -d 30 "http://localhost:3000/api/transactions?tenant=t_7&status=posted"
```

This reports latency percentiles and throughput under concurrent load, which is what users experience.

## Profiling in Node: where does the time go?

Benchmarks tell you *how long*. Profilers tell you *where*.

### CPU profiling

```bash
# Option 1: Chrome DevTools
node --inspect dist/server.js
# open chrome://inspect, click "inspect", go to the Performance or Profiler tab, record while sending requests

# Option 2: write a .cpuprofile file
node --cpu-prof --cpu-prof-dir=./profiles dist/scripts/generate-statements.js
# then drag the file into Chrome DevTools > Performance

# Option 3: flame graphs via clinic.js or 0x
npx 0x dist/scripts/generate-statements.js
```

Reading a flame graph:

```
|------------------------- main (100%) --------------------------|
|---- generateStatements (92%) -----|------ other (8%) ---------|
|-- buildLines (85%) --|- fmt (7%) -|
|- Array.find (81%) -|
```

- **Width is time.** The x-axis is not chronological; it is the share of samples in that call path.
- **Look for wide plateaus**: functions that are wide at the top of their stack are where CPU is actually spent ("self time").
- An accidental quadratic often shows up as `Array.prototype.find` or `includes` dominating the graph.

### What CPU profiles do not show

If your request takes 900 ms but the CPU profile shows 30 ms of JavaScript, the rest is **waiting**: database, HTTP calls, file I/O, or the event loop being blocked by something else. For that you need:

- **Timing spans around I/O.** Wrap queries and external calls and log durations, or better, use OpenTelemetry tracing to get a waterfall per request.
- **Database-side tools.** `pg_stat_statements` shows which query shapes consume the most total time across all requests:

```sql
SELECT calls, round(total_exec_time) AS total_ms, round(mean_exec_time, 2) AS mean_ms, query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;
```

Sort by **total** time, not mean. A 2 ms query called 4 million times a day matters more than a 3-second report run twice.

### Event loop lag

Node runs your JavaScript on one thread. A synchronous 200 ms loop blocks every other request on that process for 200 ms. Measure it:

```ts
import { monitorEventLoopDelay } from "node:perf_hooks";
const h = monitorEventLoopDelay({ resolution: 10 });
h.enable();
setInterval(() => {
  console.log(`event loop delay p99=${(h.percentile(99) / 1e6).toFixed(1)}ms`);
  h.reset();
}, 10_000);
```

If p99 event loop delay is high, some CPU-heavy work (big JSON parse, sorting a huge array, PDF generation) needs to move off the main thread (worker threads, or a background job, covered in Phase 3).

## Percentiles: p50, p95, p99

Averages hide pain. Suppose 100 requests to the reports endpoint:

```
95 requests at  80 ms
 4 requests at 400 ms
 1 request  at 6000 ms

mean = (95*80 + 4*400 + 6000) / 100 = 152 ms   <- "looks fine"
p50  =  80 ms   half of requests are faster than this
p95  =  80 ms   (borderline: the 95th value)
p99  = 400 ms   1 in 100 requests is slower than this
max  = 6000 ms
```

- **p50 (median):** the typical experience.
- **p95 / p99:** the tail. This is where timeouts, angry customers, and incidents live.
- **Why tails matter more than they look:** a page that makes 10 API calls is slow if *any* of them is slow. If each call has a 1% chance of hitting p99, about 10% of page loads hit at least one. Your biggest customers, with the most data, often live permanently in the tail.

Rules:

- **Never average percentiles** across servers or time windows. Aggregate the raw data (or histograms) and recompute.
- **Set targets as percentiles:** "p95 under 200 ms for the invoice list" is a useful SLO; "average under 100 ms" is not.
- **Look at tails per tenant** in SaaS. A global p95 can look healthy while one large tenant's p50 is 5 seconds.

## Pagination: offset vs keyset

The most common real-world slow endpoint is a list that gets slower the further you page.

### Offset pagination

```sql
SELECT id, posted_at, amount_cents, description
FROM transactions
WHERE tenant_id = $1
ORDER BY posted_at DESC, id DESC
LIMIT 50 OFFSET 200000;
```

To return rows 200,001 to 200,050, Postgres must find and discard the first 200,000 rows. Even with a perfect index, the work is `O(offset + limit)`. Page 1 takes 0.3 ms; page 4,000 takes 300 ms.

```
OFFSET 200000 LIMIT 50

index order: [ skip skip skip ... 200,000 rows ... skip ][ take 50 ]
                \___________ wasted work _____________/
```

Offset pagination also produces **duplicates and gaps** when rows are inserted or deleted while a user is paging: a new transaction at the top shifts everything down by one, so the user sees the last row of page 1 again at the top of page 2.

### Keyset (cursor) pagination

Instead of "skip N rows", say "give me rows after the last one I saw":

```sql
-- first page
SELECT id, posted_at, amount_cents, description
FROM transactions
WHERE tenant_id = $1
ORDER BY posted_at DESC, id DESC
LIMIT 50;

-- next page: pass the last row's (posted_at, id) as the cursor
SELECT id, posted_at, amount_cents, description
FROM transactions
WHERE tenant_id = $1
  AND (posted_at, id) < ($2, $3)
ORDER BY posted_at DESC, id DESC
LIMIT 50;
```

With an index on `(tenant_id, posted_at DESC, id DESC)`, Postgres seeks directly to the cursor position and reads 50 rows. Every page costs the same: `O(log n + limit)`.

Key details:

- **The sort must be unique.** `posted_at` alone has ties; add `id` as a tiebreaker or rows will be skipped or repeated across page boundaries.
- **Row value comparison** `(a, b) < (x, y)` is Postgres syntax that matches a composite index cleanly. Keep the index column order and sort directions consistent with it.
- **Encode the cursor** as an opaque string for the API:

```ts
type Cursor = { postedAt: string; id: string };
const encode = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString("base64url");
const decode = (s: string): Cursor => JSON.parse(Buffer.from(s, "base64url").toString());

async function listTransactions(tenantId: string, after?: string) {
  const c = after ? decode(after) : null;
  const { rows } = await pool.query(
    `SELECT id, posted_at, amount_cents, description
       FROM transactions
      WHERE tenant_id = $1
        AND ($2::timestamptz IS NULL OR (posted_at, id) < ($2, $3))
      ORDER BY posted_at DESC, id DESC
      LIMIT 51`,
    [tenantId, c?.postedAt ?? null, c?.id ?? null],
  );
  const hasMore = rows.length > 50;
  const page = rows.slice(0, 50);
  const last = page.at(-1);
  return {
    data: page,
    nextCursor: hasMore && last ? encode({ postedAt: last.posted_at.toISOString(), id: last.id }) : null,
  };
}
```

(Fetching `LIMIT 51` tells you whether another page exists without a separate count query.)

Trade-offs:

| | Offset | Keyset |
|---|---|---|
| Jump to page 37 | Yes | No (only next/previous) |
| Cost of deep pages | Grows linearly | Constant |
| Stable under inserts | No | Yes |
| Total page count | Needs `COUNT(*)` (slow on big tables) | Usually omitted |
| Best for | Small admin tables, numbered pages | Feeds, ledgers, exports, infinite scroll, APIs |

Also note: `SELECT COUNT(*)` on millions of rows is itself slow. Many SaaS apps show "50 of many" or an estimate rather than an exact total on huge tables.

## Common mistakes

- **Timing one run** and reporting it as fact.
- **Including warm-up or data generation** in timings.
- **Comparing averages** and ignoring p95/p99.
- **Profiling CPU when the problem is I/O**, then optimizing JavaScript that was 3% of the request.
- **Benchmarking on a 500-row dev database.**
- **Keyset pagination on a non-unique sort**, causing skipped rows.
- **Offset pagination for exports**, making a full export `O(n^2)` across pages.

## In the real world

Production performance work starts from observability: APM traces, `pg_stat_statements`, and latency histograms per endpoint and per tenant. Engineers pick the endpoint with the worst p95 weighted by traffic, reproduce it locally against a production-sized dataset, profile, fix, and verify with both a micro-benchmark and a load test. Results go in the PR description as before/after tables with the conditions stated. That habit, numbers plus conditions in every performance PR, is one of the clearest signals of engineering maturity.

## Try it

1. Write the `bench` helper above. Benchmark a nested-loop match vs a Map match at 1k, 10k, and 50k items. Plot or tabulate the growth.
2. Run the slow version with `node --cpu-prof`, open the profile in DevTools, and identify the hot function.
3. Seed 1,000,000 transactions. Time offset pagination at pages 1, 100, and 10,000 vs keyset pagination at the same depths. Record p50 and p95 over 50 runs each.
4. Run `autocannon` against your list endpoint before and after switching to keyset. Record p50, p95, p99, and requests per second.
