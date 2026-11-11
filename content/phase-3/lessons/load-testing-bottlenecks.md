## Why this matters

"It's fast on my machine" is not a performance claim. Your local environment has one user, a warm cache, a tiny database and zero network latency. Production has thousands of concurrent users, cold caches after a deploy, a database 1,000 times larger, and a connection pool that runs out at exactly the wrong moment.

Load testing is how you find out what your system does under realistic pressure **before** your customers find out for you. Done well, it answers concrete questions: How many requests per second can we serve while keeping p95 under 200 ms? What breaks first? What happens when we exceed that? Every design decision in this phase (caching, queues, horizontal scaling, locking) is a hypothesis until a load test confirms it.

## Vocabulary

- **Virtual user (VU):** a simulated client running your script in a loop.
- **Throughput:** requests per second (RPS) the system completes.
- **Latency:** time for one request. Reported as **percentiles**, never just the average.
- **p50 / p95 / p99:** the latency below which 50%, 95%, 99% of requests fall. p99 = 800 ms means 1 in 100 requests is slower than 800 ms. A dashboard page making 20 API calls hits the p99 on a large share of page loads, so tail latency is what users actually feel.
- **Error rate:** share of failed requests (5xx, timeouts, connection refused).
- **Saturation:** how full a resource is (CPU %, connection pool in use, queue depth).

Why not averages? If 95 requests take 50 ms and 5 take 6 seconds, the average is about 350 ms, which describes nobody's experience. The p95 and p99 reveal the 5 users having a terrible time.

## Types of load tests

| Test | Shape | Question it answers |
| --- | --- | --- |
| Smoke | 1–5 VUs, 1 minute | Does the script work at all? |
| Load | Expected peak, 10–30 minutes | Do we meet our targets at normal peak? |
| Stress | Ramp beyond peak until it breaks | Where is the breaking point, and how does it fail? |
| Spike | Sudden jump from low to very high | Do we survive the 9:00 a.m. rush or the auction close? |
| Soak | Moderate load for hours | Memory leaks, connection leaks, disk filling up |

### Open vs closed models

This distinction trips up almost everyone.

- **Closed model:** a fixed number of VUs, each sends a request, waits for the response, then sends the next. If your server slows down, VUs send fewer requests, and the load **drops automatically**. It hides overload.
- **Open model:** requests **arrive at a fixed rate** (say 5,000/s) regardless of how fast the server responds. This is how real internet traffic behaves: users do not wait for each other.

To test "5,000 requests per second", you need an open model. In k6 that means the `constant-arrival-rate` or `ramping-arrival-rate` executors.

## k6

k6 scripts are JavaScript (TypeScript also runs in recent versions), executed by a Go engine that can generate a lot of load from one machine.

```js
// load/bids.js  -- run with: k6 run load/bids.js
import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Counter } from "k6/metrics";

// By default k6 counts every 4xx as a failed request, so 409 "outbid" responses would
// push http_req_failed over 1%. Declare 409 an expected status for this test.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 409));

const bidLatency = new Trend("bid_latency", true);
const rejectedBids = new Counter("rejected_bids");

export const options = {
  scenarios: {
    browse: {
      executor: "constant-arrival-rate",
      rate: 4000,            // 4,000 iterations per second
      timeUnit: "1s",
      duration: "5m",
      preAllocatedVUs: 500,
      maxVUs: 2000,
      exec: "browse",
    },
    bid: {
      executor: "ramping-arrival-rate",
      startRate: 100,
      timeUnit: "1s",
      preAllocatedVUs: 200,
      maxVUs: 1000,
      stages: [
        { target: 1000, duration: "2m" },  // ramp to 1,000 bids/s
        { target: 1000, duration: "2m" },  // hold
        { target: 0, duration: "1m" },
      ],
      exec: "bid",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],                    // < 1% errors
    "http_req_duration{scenario:browse}": ["p(95)<200"],
    bid_latency: ["p(95)<200", "p(99)<500"],
  },
};

const BASE = __ENV.BASE_URL || "http://localhost:3000";

export function browse() {
  const auctionId = `a-${Math.floor(Math.random() * 50)}`;
  const res = http.get(`${BASE}/api/auctions/${auctionId}`);
  check(res, { "status 200": (r) => r.status === 200 });
}

export function bid() {
  const auctionId = `a-${Math.floor(Math.random() * 50)}`;
  const amount = 1000 + Math.floor(Math.random() * 100000);
  const res = http.post(
    `${BASE}/api/auctions/${auctionId}/bids`,
    JSON.stringify({ amountCents: amount, bidderId: `u-${__VU}` }),
    { headers: { "Content-Type": "application/json" } },
  );
  bidLatency.add(res.timings.duration);
  if (res.status === 409) rejectedBids.add(1); // outbid: expected, not an error
  check(res, { "accepted or outbid": (r) => r.status === 201 || r.status === 202 || r.status === 409 });
}
```

Things to notice:

- **Thresholds** turn the test into pass/fail, so you can run it in CI.
- **Realistic data:** random auction IDs spread load across keys. Hitting the same ID every time tests your cache, not your system. Hitting only random IDs tests your cache misses. Real traffic is skewed: a few hot items get most traffic. Model that if it matters.
- **Business errors are not system errors.** A 409 "outbid" is correct behavior. Separate it from 5xx: that is what the `setResponseCallback` line does, because `http_req_failed` otherwise treats any status of 400 or above as a failure.

## Artillery

Artillery uses YAML scenarios and is popular for multi-step user flows.

```yaml
# load/checkout.yml  -- run with: npx artillery run load/checkout.yml
config:
  target: "http://localhost:3000"
  plugins:
    ensure: {}
  phases:
    - duration: 60
      arrivalRate: 50
      rampTo: 500
      name: "ramp"
    - duration: 300
      arrivalRate: 500
      name: "sustained"
  ensure:
    thresholds:
      - http.response_time.p95: 200
      - http.response_time.p99: 500
    conditions:
      - expression: "http.codes.500 < 10"
scenarios:
  - name: "reserve a seat"
    flow:
      - post:
          url: "/api/login"
          json: { email: "load+{{ $randomNumber(1, 10000) }}@test.dev", password: "x" }
          capture:
            - json: "$.token"
              as: token
      - get:
          url: "/api/events/evt-1"
          headers: { Authorization: "Bearer {{ token }}" }
      - post:
          url: "/api/events/evt-1/reservations"
          headers: { Authorization: "Bearer {{ token }}" }
```

Artillery's `arrivalRate` is an open model: new virtual users start at that rate regardless of response times.

## Reading the results

k6 prints a summary like this:

```
     http_req_duration..............: avg=48ms  min=2ms  med=21ms  max=4.1s  p(90)=95ms  p(95)=180ms
       { scenario:browse }..........: avg=12ms  min=2ms  med=8ms   max=310ms p(90)=22ms  p(95)=35ms
     bid_latency....................: avg=210ms min=9ms  med=140ms max=4.1s  p(90)=480ms p(95)=720ms
     http_req_failed................: 2.31%
     http_reqs......................: 1,412,330  4,707/s
     dropped_iterations.............: 18,422
     vus_max........................: 2000
```

How to interpret it:

- **Browse is healthy** (p95 35 ms): reads are served from cache.
- **Bids are not** (p95 720 ms, above the 200 ms target).
- **2.31% failed** is above the 1% threshold.
- **dropped_iterations** means k6 could not start iterations on schedule because all VUs were busy waiting for slow responses. The system is not keeping up with the arrival rate. In an open model this is a direct signal of overload.
- Achieved 4,707 req/s against a target of 5,000.

Now look at the **shape over time**, not just the summary. Export to a dashboard (k6 can stream to Grafana/InfluxDB/Prometheus, or use `--out json` and plot it). The classic overload pattern:

```
latency
   ^                                   ________
   |                                  /
   |                                 /
   |                    ____________/
   |___________________/
   +-------------------------------------------> requests/s
                      ^ knee: a resource saturates
```

Below the knee, latency is flat. At the knee, some resource is fully used and requests start queueing. Past it, latency climbs steeply and errors appear. Your sustainable capacity is somewhat below the knee.

## Finding the bottleneck

Load test results tell you **that** something is slow. Server-side metrics tell you **what**. Watch these during the test:

| Resource | What to watch | Symptom when saturated |
| --- | --- | --- |
| App CPU | CPU % per instance, Node event loop lag | Latency rises across all endpoints, even trivial ones |
| DB connections | Pool in-use vs max, wait time to acquire | Requests hang, then time out; DB CPU may look fine |
| DB CPU / IO | CPU %, slow query log, `pg_stat_statements` | Specific queries slow down; disk IO wait high |
| DB locks | `pg_locks`, `pg_stat_activity` with wait_event | One endpoint (the contended one) is slow; others fine |
| Redis | ops/s, CPU (single-threaded), latency | All cached endpoints slow together |
| Queue | Depth, oldest job age | API fast, but results arrive later and later |
| Network / LB | Bandwidth, connection count | Errors at the edge, connection resets |
| Load generator | k6 machine CPU | Results flatten: you are measuring k6, not your app |

A systematic process:

1. **Establish a baseline** with a smoke test and record it.
2. **Ramp** the load until a threshold breaks. Note the RPS at the knee.
3. **Find the saturated resource** using the table above. Exactly one thing is usually the first bottleneck.
4. **Form a hypothesis**: "Bids are slow because 1,000 bids/s across 50 auctions means about 20 transactions/s per hot row with `FOR UPDATE`, and each holds the lock for 30 ms because it also writes an audit log row synchronously."
5. **Change one thing.** Shorten the locked section, add a cache, add a queue, add an index.
6. **Rerun the same test** and compare. If it did not improve, your hypothesis was wrong; revert.
7. Repeat. The bottleneck moves: fixing the DB lock may reveal app CPU as the next limit.

Measuring Node event loop lag is cheap and very revealing:

```ts
import { monitorEventLoopDelay } from "node:perf_hooks";
const h = monitorEventLoopDelay({ resolution: 20 });
h.enable();
setInterval(() => {
  logger.info({ p99LagMs: h.percentile(99) / 1e6 }, "event loop");
  h.reset();
}, 5000);
```

If event loop p99 lag is over about 50 ms, something synchronous (JSON.stringify of big objects, bcrypt with sync APIs, PDF rendering) is blocking every request on that instance.

## Testing honestly

- **Never load test production** without coordination, and never test third-party APIs you do not own (payment providers, email). Stub them.
- **Use production-like data volume.** A query that is fast on 1,000 rows may be catastrophic on 10 million (Phase 2).
- **Run the load generator on separate hardware** from the system under test, or both compete for CPU and the results are meaningless.
- **Test the cold path.** Flush Redis and run again. Your system must survive the cache being empty after a deploy or failover.
- **Warm up** before measuring, and run long enough (at least several minutes) for pools, JIT and caches to stabilize.
- **Record everything:** git commit, config, instance sizes, results. A load test you cannot reproduce is an anecdote.

## Common mistakes

- **Reporting averages.** Always report p95 and p99 with throughput and error rate.
- **Closed-model tests for throughput claims.** "We handled 500 VUs" says nothing about requests per second.
- **Load generator is the bottleneck.** If k6's CPU is at 100%, the numbers describe k6.
- **Everyone hits the same key.** 100% cache hit ratio is not a realistic test.
- **Changing several things between runs.** You will not know which change helped.
- **Ignoring errors because latency looks good.** Fast 500s are still failures; a system that rejects requests quickly looks wonderful on latency charts.
- **No server-side metrics.** Without them you can see that it is slow but not why.

## In the real world

Teams run load tests before big launches, before known peaks (tax season, Black Friday, payroll day) and increasingly in CI as a performance regression gate with modest thresholds. k6 (now part of Grafana Labs) has become the default choice for JavaScript teams; Artillery, Gatling, Locust (Python) and JMeter are common too. The most valuable output of a load test is rarely the headline number. It is the sentence in the incident-free postmortem: "We found the connection pool exhausted at 3,200 req/s in staging, raised it with PgBouncer, and launch day peaked at 2,800 req/s without issue."

## Try it

1. Install k6. Write a smoke test against any endpoint of one of your apps. Confirm it passes.
2. Convert it to a `ramping-arrival-rate` stress test from 50 to 2,000 req/s over 5 minutes, with p95 and error-rate thresholds.
3. While it runs, watch CPU (app and DB), connection pool usage and event loop lag. Find the knee and identify which resource saturated first.
4. Make one change to address it. Rerun and write down before/after p95, p99, RPS and error rate in a table.
5. Flush your cache and rerun to see the cold-start behavior.
6. On the whiteboard, draw your system with the load generator, and annotate each component with the metric you watched and its value at the knee.
