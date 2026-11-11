## What a strong solution looks like

The numbers force the architecture. The three document classes differ by about 100x in render time and memory, so they get separate queues and worker pools: a small-document pool that is always warm, a statement pool that scales up for the batch on the 1st, and a heavy-report pool where each render runs in its own memory-limited container. The main ERP API only inserts a request row, enqueues a job and returns `202`. PDFs go to object storage and are downloaded through short-lived signed URLs, never through the API.

The document is honest about month-start. It computes worker-seconds for each class, shows how many concurrent slots meet each target, and says what happens if autoscaling is slower than the 9:00 a.m. spike. Every component in the diagram maps to a requirement or a number.

## Reference approach

### Diagram in words

```
Browser -> LB -> ERP API --insert--> Postgres (report_requests, documents)
                    |                       ^
                    +--enqueue--+           | status updates
                                v           |
             [q:small]  [q:statements]  [q:heavy]   (Redis/BullMQ or SQS)
                 |            |              |
           small pool   statement pool   heavy pool (1 render / container, 2 GB limit)
           (always on)  (scale on depth) (scale on oldest-job age)
                 \            |              /
                  +----> Object storage (S3/R2) <---- signed URL ---- Browser
                         lifecycle: ad hoc 90 d, legal 7 y (object lock)
Scheduler (1st, 02:00) -> statement fan-out job -> per-tenant chunk jobs -> per-customer jobs
Failed after N attempts -> DLQ -> alert
Completion -> status row (polling) + email/in-app for heavy reports
```

### Estimations

**Small documents.** 200,000/day. Assume 80% in a 10-hour business day: 160,000 / 36,000 s is about 4.4/s, peaking at 5x, about 22/s. Little's Law: 22/s x 0.3 s = 6.6 renders in flight. Keep utilization near 50% so queueing stays short and p95 stays far under 5 s: about 14 render slots. With 4 browser pages per container, that is 4 containers, always on.

**Statements.** 3,000 x 400 = 1.2 million on the 1st. 1.2M x 0.8 s = 960,000 worker-seconds, about 267 worker-hours. To finish in 4 hours you need 267 / 4 = 67 slots; in 8 hours, 34. Choose 60–70 slots for a run starting at 02:00, finishing before the business day. Volume: 1.2M x 250 KB = 300 GB per month.

**Heavy reports.** Normal day: 5,000 over 10 hours is 0.14/s. Assume 100 s average render: 0.14 x 100 = 14 renders in flight. Month-start: 10x is 50,000/day, 1.4/s average, and assume the 9:00–11:00 window carries 2x the hourly average, about 2.8/s. In flight: 2.8 x 100 = 280 renders. At up to 1.5 GB each, that is about 420 GB of RAM, for example 280 containers with a 2 GB limit, or about 35 nodes with 16 GB. The 10-minute p95 target leaves about 7 minutes of queue wait after a 180 s render, so capacity must arrive within minutes. Honest answer: autoscaling from 20 to 280 slots takes several minutes of node provisioning. Pre-scale on a schedule at 08:30 on the first three business days, then let queue age drive the rest.

**Storage.** Invoices/POs: 200,000 x 120 KB = 24 GB/day, about 8.8 TB/year, 62 TB over 7 years. Statements: 300 GB x 12 = 3.6 TB/year, 25 TB over 7 years. Heavy ad hoc: about 40 GB/day normally plus about 1.1 TB extra in the first three days of the month, about 2 TB/month, but with 90-day retention the steady state is about 6 TB. After 7 years: about 93 TB. At about $0.023/GB-month in a standard tier that would be about $2,100/month; moving legal documents older than 90 days to an infrequent-access tier cuts it by half or more.

**Egress.** Assume each document is downloaded 1.5 times: (24 GB + 40 GB) x 1.5 is about 100 GB/day, about 3 TB/month, around $250/month at typical cloud egress prices (near zero on providers without egress fees).

**Compute cost (rough).** Small pool: 4 small containers always on. Statements: 67 slots x 4 hours monthly. Heavy: about 20 slots normally, 280 for a few hours on three days. Ballpark $1,500–4,000/month for compute depending on provider and spot usage.

### Key deep dives

**Queue isolation.** Separate queues and pools mean a 2,000-page ledger never occupies a slot an invoice is waiting for. A priority number on a shared queue is not enough: once all workers are busy with 3-minute renders, priority only reorders the waiting line.

**Tenant fairness.** Limit each tenant to a fixed number of heavy renders in flight (for example 5) using a per-tenant counter or BullMQ groups (a Pro feature) or per-tenant queues served round-robin. A tenant requesting 3,000 reports waits on its own backlog, not everyone's.

**Statement fan-out.** A scheduler enqueues one job per tenant, each of which enqueues per-customer jobs in chunks of 500 and writes a `statement_batches` row with `expected` and `completed` counts. Completion is tracked with an atomic `UPDATE ... SET completed = completed + 1 ... RETURNING` guarded by a unique `(batch_id, customer_id)` row, so retries do not double-count.

**Idempotency.** Request dedupe key `(tenant, report_type, params_hash, data_version)`: five clicks return the same request ID. Output key `tenants/{t}/reports/{requestId}/v{n}.pdf`. Legal documents are written once with object lock; regeneration creates `v{n+1}`.

**Bounded jobs.** Small: 30 s timeout. Heavy: 15 minute timeout; the container is killed at its memory limit, and the job fails with "report too large, narrow the date range" after 2 attempts instead of looping. Chunking a ledger into month sections rendered in parallel and merged reduces both time and the cost of a crash at page 1,900.

### Failure modes

| Failure | Behavior | What the user sees |
| --- | --- | --- |
| Queue unavailable | API returns 503 for new requests; rest of ERP works | "Report generation temporarily unavailable" |
| Heavy pool exhausted at month-start | Jobs wait; autoscaler adds nodes | Status "queued" with position or ETA |
| Worker OOM | Container killed, job retried once, then failed with clear message | Failure notice suggesting a smaller range |
| Object storage down | Workers retry with backoff; downloads fail | Report stays "processing"; downloads error briefly |
| Duplicate clicks | Dedupe key returns existing request | Same progress bar, no duplicate PDF |
| Bad template deploy | Jobs fail into DLQ, alert fires; replay after fix | Delayed reports, then delivered |

## Common mistakes

- **One queue with priorities** for all classes, so month-start ledgers fill every worker.
- **Averages instead of peaks.** Sizing heavy workers for 0.14/s and discovering 2.8/s on the 1st.
- **Streaming PDFs through the API**, which reintroduces the memory and latency problem the service was meant to remove.
- **No timeouts or memory limits** on heavy renders, so one 2,000-page report takes down a node shared with others.
- **Statement batch as one giant job** that cannot be retried partially or tracked.
- **Ignoring retention law.** Mutable or overwritten legal PDFs, no lifecycle rules.

## Trade-offs worth discussing

- **Pre-scaling vs pure autoscaling** for a predictable monthly spike: pre-scaling costs a few idle hours but meets the target reliably.
- **Headless browser vs a PDF library.** Chromium gives HTML templates and fidelity at high memory cost; a library such as PDFKit is lighter but slower to build templates with.
- **Rendering statements overnight vs on demand.** Batch is predictable but renders statements nobody opens; on-demand saves compute but moves load into business hours.

## Grade yourself

| Dimension | Strong | Acceptable | Needs work |
| --- | --- | --- | --- |
| Estimations | All classes sized with Little's Law, storage for 1 and 7 years, egress, cost, arithmetic shown | Most numbers, some unexplained | Few numbers, or averages only |
| Isolation | Separate queues and pools per class, per-tenant limits | Separate queues, shared pool | Single queue or rendering in the API |
| Month-start | Explicit 9:00 a.m. narrative, capacity math, pre-scaling or honest gap | Mentions spike, no math | Not addressed |
| Reliability | Timeouts, memory limits, idempotency keys, DLQ, immutable versions | Retries and DLQ only | No failure handling |
| Failure table | Six or more rows with user-visible outcome | Five rows, some vague | Missing or under five |
| Diagram | Matches DESIGN.md, every box justified | Mostly consistent | Boxes without purpose |

## Going further

1. Compute the cost of your heavy pool on spot instances and design for spot interruption (checkpointed chunks).
2. Add a multi-region recovery plan with RPO and RTO for legal documents.
