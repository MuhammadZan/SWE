## Scenario

You are building the backend for a live auction feature inside a B2B procurement SaaS. Buyers bid up on lots during timed events: each new bid must beat the current highest bid. When a popular event opens or its final minute approaches, thousands of users refresh the lot page and fire bids within seconds. Today's prototype is a single Express server writing bids straight to Postgres. In a rehearsal with 300 users it oversold, showed stale leaders, and fell over.

Your task: design and build a backend that absorbs **5,000 requests per second** of mixed traffic while keeping **p95 latency under 200 ms**, with **zero incorrect auction outcomes**, and prove it with a reproducible load test. You may instead build a seat/slot reservation engine (event seats, warehouse dock slots, appointment booking) with the same targets; the concurrency problem is the same.

## Scale numbers

- 50 concurrent auctions (lots), 20,000 registered bidders, a peak of 5,000 req/s.
- Traffic mix at peak: about 80% reads (lot details, current price, leader, time remaining), 20% writes (bids), so roughly 1,000 bids/s.
- Traffic is skewed: the top 5 lots receive about 60% of all traffic.
- Every accepted bid must be durable (Postgres) and auditable.
- Side effects per accepted bid: outbid notification to the previous leader, audit log entry, analytics event.

## Starting point

- Node/TypeScript API, Postgres, Redis, BullMQ.
- Docker Compose for local infrastructure.
- k6 (or Artillery) for load generation, running on a separate machine or at least a separate container with its own CPU allocation.

## What to build

1. **Read path:** `GET /api/lots/:id` serving the current price, leader and end time from Redis (cache-aside with TTLs and stampede protection), falling back to Postgres.
2. **Write path:** `POST /api/lots/:id/bids` that validates and accepts or rejects a bid atomically. Choose and justify your approach: atomic conditional SQL update, `SELECT ... FOR UPDATE`, optimistic versioning, or a Redis Lua script as gatekeeper with Postgres as source of truth. Rejected bids return `409`.
3. **Asynchronous side effects:** notifications, audit enrichment and analytics go to a BullMQ queue processed by separate workers with retries, idempotency and a dead-letter path.
4. **Horizontal app tier:** at least 2 stateless API instances behind a load balancer (Nginx or HAProxy in Compose), with connection pooling sized deliberately.
5. **Protection:** per-user rate limiting on bids, returning `429` with `Retry-After`.
6. **Load test:** a k6 script using arrival-rate executors that models the read/write mix and hot-lot skew, with thresholds for p95 under 200 ms and error rate under 1%.
7. **Correctness verifier:** a script that runs after the load test and asserts no lot ended with a bid that violates its rules (no accepted bid lower than a previous accepted bid, leader equals highest accepted bid, every accepted bid has exactly one row).

## What to draw

Before coding, draw the target architecture on the whiteboard; after load testing, update it with what actually changed. Both versions go in the repo.

## Constraints

- No synchronous external calls (email, webhooks) in the bid request path.
- Every Redis key has a TTL, except data deliberately stored as source of truth (justify any).
- The bid endpoint must remain correct if Redis is flushed mid-test.
- Report numbers honestly: if you do not reach 5,000 req/s on your hardware, document the highest sustained rate meeting the latency target and identify the bottleneck.

## How to verify

- The k6 run passes its thresholds at your target rate for at least 5 minutes. Commit the summary output.
- The correctness verifier passes after the run, with zero violations.
- Run the test once with caching disabled and once enabled; report the difference in p95 and DB CPU.
- Kill one API instance mid-test: the error rate spike is brief and the system recovers.
- Flush Redis mid-test: latency spikes then recovers, and the verifier still passes.
- `RESULTS.md` contains a table of runs (configuration change, RPS, p50, p95, p99, error rate, bottleneck observed) showing at least three iterations of find-bottleneck, change-one-thing, re-measure.
