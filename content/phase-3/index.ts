import type { PhaseMeta } from "@/lib/types";

export const phase: PhaseMeta = {
  id: 3,
  slug: "system-design",
  title: "System Design & Traffic Scaling",
  tagline: "Caching, Queues, System Architecture for 100k Users",
  objective:
    "Transition from single-user applications to robust architectures that can handle thousands of concurrent transactions without crashing.",
  overview:
    "Phase 2 made individual queries and algorithms fast. This phase is about what happens when thousands of people hit the system at once: the database runs out of connections, a slow PDF render starves every other request, two bidders win the same lot, and a cache expiring at 9:00 a.m. takes Postgres down with it.\n\nYou will learn a repeatable framework for system design (requirements, back-of-envelope estimation, high-level design, deep dives, trade-offs) and the core building blocks that real SaaS platforms use to scale: Redis caching, message queues and background workers, load balancers and stateless services, read replicas and connection pooling, locking and rate limiting. Every concept is tied to an ERP or SaaS scenario you will recognize.\n\nThis is the most diagram-heavy phase. Use the whiteboard for every problem: draw first, estimate with real numbers, then build. The capstone ends with proof rather than claims: a load test pushing 5,000 requests per second at an auction backend while keeping p95 latency under 200 ms and every auction outcome correct.",
  lessons: [
    {
      slug: "system-design-framework",
      title: "How to Approach a System Design Problem",
      summary:
        "A repeatable five-step framework (requirements, estimation, high-level design, deep dives, trade-offs) with worked back-of-envelope numbers for a real SaaS.",
      minutes: 50,
      keyTakeaways: [
        "Separate functional requirements (what it does) from non-functional ones (latency, throughput, availability, consistency, cost); the non-functional ones drive the architecture.",
        "Back-of-envelope estimation aims for the right order of magnitude: DAU, average and peak QPS, storage per year and bandwidth tell you where the real scaling problem is.",
        "Design for peak, not average; business software often peaks at 5-10x average around working hours and month-end.",
        "Little's Law (in-flight = arrival rate x duration) sizes connection pools and worker fleets before you write code.",
        "Start with the simplest design that meets the numbers, then deep dive only into the parts the estimates flag as hard.",
        "Every design decision is a trade-off; write down what you gain, what you pay and what happens when each component fails.",
      ],
      quiz: [
        {
          question:
            "You are asked to design a timesheet feature for an ERP with 30,000 employees. Before drawing any boxes, what should you do first?",
          options: [
            "Pick a message broker so the design can scale later",
            "Clarify functional and non-functional requirements and estimate peak load",
            "Design the database schema in full detail",
            "Choose between microservices and a monolith",
          ],
          answer: 1,
          explanation:
            "Requirements and estimates determine everything else. Without knowing peak QPS, consistency needs and what is out of scope, you cannot tell whether a broker, microservices or a detailed schema are needed at all. Technology choices come after the numbers.",
        },
        {
          question:
            "Your estimate shows 18 requests per second on average for an invoicing SaaS used mostly during business hours. What peak figure should you design for?",
          options: [
            "18 req/s, since the average is what the system sees",
            "Roughly 5-10x the average (about 90-200 req/s), accounting for working hours and month-end",
            "1,000x the average to be safe",
            "Half the average, because not all users are active at once",
          ],
          answer: 1,
          explanation:
            "Averages spread load over 24 hours, but business software concentrates traffic into working hours and spikes at known events like month-end. A 5-10x peak factor is a reasonable starting assumption. 1,000x leads to wildly overbuilt systems; the average guarantees you fall over at peak.",
        },
        {
          question:
            "An API receives 1,000 req/s and each request holds a database connection for 150 ms. Roughly how many connections are in use at once?",
          options: ["15", "150", "1,000", "6,667"],
          answer: 1,
          explanation:
            "Little's Law: in-flight = arrival rate x time in system = 1,000 x 0.15 s = 150. That already exceeds Postgres's default max_connections of 100, so you have found a bottleneck (needing pooling or shorter queries) on paper.",
        },
        {
          question:
            "Estimation for an ERP shows 73 GB/year of invoice rows and 5.5 TB/year of invoice PDFs. Which design conclusion follows?",
          options: [
            "Store PDFs as bytea columns next to the invoice rows for consistency",
            "Shard Postgres immediately because of the data volume",
            "Keep rows in Postgres and put PDFs in object storage, storing only the object key in the row",
            "Move everything to a NoSQL database",
          ],
          answer: 2,
          explanation:
            "73 GB/year is comfortable for a single Postgres with indexes. Multi-terabyte binary blobs bloat the database, backups and replication, while object storage is built for them and cheap. Sharding or switching databases is not justified by the row volume.",
        },
        {
          question:
            "In a design review, a colleague proposes Kafka, Kubernetes and five microservices for a feature with an estimated peak of 40 req/s. What is the strongest response?",
          options: [
            "Agree, because it will be needed eventually",
            "Ask which requirement or number each component is justified by; at 40 req/s a single service with Postgres likely meets every target with far less operational cost",
            "Suggest replacing Kafka with RabbitMQ",
            "Reject it because microservices are always bad",
          ],
          answer: 1,
          explanation:
            "Every box must map to a requirement or a number. At 40 req/s the extra components add cost, failure modes and operational burden without solving a real problem. The answer is not 'never use them' but 'justify them with the estimates'.",
        },
      ],
      resources: [
        {
          label: "System Design Primer (donnemartin)",
          url: "https://github.com/donnemartin/system-design-primer",
          kind: "web",
        },
        {
          label: "ByteByteGo: A Framework for System Design Interviews",
          url: "https://bytebytego.com/courses/system-design-interview/a-framework-for-system-design-interviews",
          kind: "web",
        },
        {
          label: "ByteByteGo: Back-of-the-envelope Estimation",
          url: "https://bytebytego.com/courses/system-design-interview/back-of-the-envelope-estimation",
          kind: "web",
        },
      ],
    },
    {
      slug: "caching-layers",
      title: "Caching Layers: Redis, TTLs and HTTP Caching",
      summary:
        "How to put fast caches in front of your database with cache-aside, write-through and write-behind, set TTLs, invalidate correctly and survive cache stampedes.",
      minutes: 55,
      keyTakeaways: [
        "A cache is a disposable copy; the system must stay correct, just slower, if every key disappears.",
        "Cache-aside (read: check cache, load on miss; write: update DB, then delete the key) is the default for SaaS apps; write-behind risks data loss and suits only counters and analytics.",
        "Use explicit invalidation for freshness and a TTL as a safety net on every key; include tenant ID and a schema version in key names.",
        "Cache stampedes happen when a hot key expires under load; prevent them with single-flight locks, TTL jitter and stale-while-revalidate.",
        "Pick the right Redis data type (hash, sorted set, set, stream) and the right eviction policy (allkeys-lru for caches, noeviction for queues).",
        "HTTP Cache-Control headers and CDNs remove requests before they reach your servers; never mark tenant-specific responses as public.",
      ],
      quiz: [
        {
          question:
            "An accountant marks an invoice as paid. Using cache-aside, what should the write path do with the cached dashboard stats for that tenant?",
          options: [
            "Recompute the stats and SET the new value in Redis before updating the database",
            "Update the database, then delete the cached key so the next read rebuilds it",
            "Leave the cache alone; the TTL will fix it",
            "Update the cached value in place with INCRBY",
          ],
          answer: 1,
          explanation:
            "Update the source of truth first, then delete the key. Deleting avoids the race where two concurrent writers update the cache in the opposite order to the database. Relying only on the TTL leaves stale data for its full duration; writing the cache first risks caching data that never committed.",
        },
        {
          question:
            "At 09:00 a popular per-tenant dashboard key expires, and 800 requests arrive during the 300 ms recompute. Postgres CPU spikes to 100%. What is this, and what fixes it?",
          options: [
            "A memory leak; increase Redis maxmemory",
            "A cache stampede; let one request recompute under a lock (single-flight) while others wait or serve stale data",
            "Replication lag; read from the primary",
            "A deadlock; add FOR UPDATE to the query",
          ],
          answer: 1,
          explanation:
            "Many concurrent misses on the same key all running the expensive query is a cache stampede (thundering herd). Single-flight locking, stale-while-revalidate and TTL jitter are the standard fixes. The other options describe unrelated problems.",
        },
        {
          question:
            "A developer caches the invoice list under the key 'invoices:page:1' with a 5-minute TTL in a multi-tenant SaaS. What is the most serious problem?",
          options: [
            "The TTL is too long",
            "The key has no tenant ID, so tenants can see each other's invoices",
            "Lists should use Redis sorted sets",
            "Page numbers should not be cached",
          ],
          answer: 1,
          explanation:
            "Without the tenant ID in the key, the first tenant to load page 1 populates it and every other tenant receives that data: a cross-tenant data leak. TTL length and data type choices are minor compared to that.",
        },
        {
          question:
            "Which use case is a reasonable fit for write-behind caching?",
          options: [
            "Recording customer payments",
            "Issuing invoice numbers",
            "Counting page views per document for an analytics widget",
            "Storing user passwords",
          ],
          answer: 2,
          explanation:
            "Write-behind acknowledges writes before they reach the database, so a cache failure can lose them. That is acceptable for approximate counters like page views, and unacceptable for payments, legally significant numbering or credentials.",
        },
        {
          question:
            "Your API returns each tenant's authenticated invoice list as JSON, and you put a CDN in front. Which Cache-Control header is appropriate for that endpoint?",
          options: [
            "public, max-age=3600",
            "public, s-maxage=300, stale-while-revalidate=60",
            "private, max-age=0, must-revalidate",
            "public, max-age=31536000, immutable",
          ],
          answer: 2,
          explanation:
            "Authenticated, tenant-specific data must not be stored by shared caches, so it needs 'private' (or no-store). Any 'public' directive lets the CDN serve one tenant's data to another. 'immutable' with a year-long max-age is for hashed static assets.",
        },
      ],
      resources: [
        {
          label: "Redis docs: Client-side caching and caching patterns",
          url: "https://redis.io/docs/latest/develop/clients/client-side-caching/",
          kind: "docs",
        },
        {
          label: "Redis docs: Data types",
          url: "https://redis.io/docs/latest/develop/data-types/",
          kind: "docs",
        },
        {
          label: "MDN: HTTP caching",
          url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching",
          kind: "docs",
        },
        {
          label: "System Design Primer: Cache",
          url: "https://github.com/donnemartin/system-design-primer#cache",
          kind: "web",
        },
      ],
    },
    {
      slug: "message-queues-background-workers",
      title: "Message Queues and Background Workers",
      summary:
        "Move slow work out of the request with the 202 Accepted pattern, and make it reliable with at-least-once delivery, idempotent handlers, retries with backoff and dead-letter queues.",
      minutes: 55,
      keyTakeaways: [
        "Queues decouple producers from consumers: fast API responses, load leveling during spikes, isolation of CPU-heavy work and independent scaling of workers.",
        "Return 202 Accepted with a job ID and a status URL; let clients poll or be notified when the work completes.",
        "Real queues deliver at least once, so every handler must be idempotent: deterministic keys, unique constraints and idempotency keys for third parties.",
        "Retry transient failures with exponential backoff and jitter; fail permanent errors immediately; send exhausted jobs to a dead-letter queue with alerting and replay.",
        "Run workers as separate processes, keep payloads to IDs and storage keys, shut down gracefully and size the pool with Little's Law while monitoring queue depth and job age.",
      ],
      quiz: [
        {
          question:
            "A user requests a 900-page year-end ledger export that takes 45 seconds to render. What should the API respond with?",
          options: [
            "200 OK with the PDF after rendering completes",
            "202 Accepted with a job ID and a URL to check status",
            "201 Created with an empty body",
            "504 Gateway Timeout, asking the user to retry",
          ],
          answer: 1,
          explanation:
            "202 Accepted means the request was received and will be processed asynchronously. Returning a job ID and status URL lets the client track progress. Holding the request for 45 seconds blocks resources and will hit proxy timeouts.",
        },
        {
          question:
            "A worker sends a payment receipt email and crashes before acknowledging the job. The queue redelivers it. What property must the handler have to avoid sending two receipts?",
          options: ["Durability", "Idempotency", "Atomicity of the queue", "Low latency"],
          answer: 1,
          explanation:
            "With at-least-once delivery, redelivery after a crash is expected. An idempotent handler (for example, recording a unique 'receipt:invoiceId' key in the database or passing an idempotency key to the provider) makes the second run a no-op.",
        },
        {
          question:
            "Your email provider returns 503 for five minutes. 8,000 queued email jobs fail. Which retry configuration is best?",
          options: [
            "Retry immediately in a tight loop until it works",
            "Retry with exponential backoff plus jitter, a capped number of attempts, then dead-letter",
            "Do not retry; mark them all failed",
            "Retry every job exactly 60 seconds later",
          ],
          answer: 1,
          explanation:
            "Exponential backoff gives the provider room to recover, jitter prevents all 8,000 jobs retrying at the same instant, and a dead-letter queue catches jobs that still fail. A fixed 60-second delay creates synchronized retry waves; tight loops amplify the outage.",
        },
        {
          question:
            "A developer enqueues image jobs with the full 12 MB file in the job payload. What is the main problem?",
          options: [
            "Jobs will be processed out of order",
            "Redis memory fills quickly and enqueue/dequeue gets slow; store the file in object storage and enqueue its key",
            "BullMQ cannot serialize binary data at all",
            "Workers cannot access the payload",
          ],
          answer: 1,
          explanation:
            "Queue backends like Redis hold jobs in memory. Large payloads exhaust memory, slow down operations and can trigger eviction or out-of-memory failures. Job payloads should carry references (IDs, storage keys), not the data itself.",
        },
        {
          question:
            "Jobs arrive at 20 per second at peak, each takes 2 seconds, and each worker process runs 4 jobs concurrently. How many worker processes keep the queue from growing?",
          options: ["2", "5", "10", "40"],
          answer: 2,
          explanation:
            "Little's Law: 20 jobs/s x 2 s = 40 jobs in flight. At 4 concurrent jobs per process, you need 40 / 4 = 10 processes. Fewer means the backlog grows during the peak; 40 processes would be 4x overprovisioned.",
        },
      ],
      resources: [
        {
          label: "BullMQ documentation",
          url: "https://docs.bullmq.io/",
          kind: "docs",
        },
        {
          label: "ByteByteGo: Message queues explained",
          url: "https://blog.bytebytego.com/p/why-do-we-need-a-message-queue",
          kind: "web",
        },
        {
          label: "System Design Primer: Asynchronism",
          url: "https://github.com/donnemartin/system-design-primer#asynchronism",
          kind: "web",
        },
        {
          label: "Hussein Nasser (YouTube)",
          url: "https://www.youtube.com/@hnasr",
          kind: "video",
        },
      ],
    },
    {
      slug: "horizontal-vertical-scaling",
      title: "Horizontal vs Vertical Scaling",
      summary:
        "When to buy a bigger box and when to add more boxes, how load balancers and stateless services work, and how to scale the database with pooling, replicas and (eventually) sharding.",
      minutes: 50,
      keyTakeaways: [
        "Vertical scaling needs no code changes but has a ceiling and a single point of failure; horizontal scaling adds redundancy and near-linear capacity for stateless services.",
        "L7 load balancers route HTTP using algorithms like round robin and least connections, and remove unhealthy instances via health checks; keep liveness checks independent of shared dependencies.",
        "Stateless means any instance can serve any request: move sessions, uploads, caches, cron jobs and rate-limit counters into shared stores.",
        "Sticky sessions are a workaround with real costs; prefer Redis-backed sessions or signed tokens.",
        "Scaling the app tier multiplies database connections; use deliberate pool sizes and PgBouncer, and send reads to replicas while handling replication lag with read-your-writes.",
        "Sharding by tenant gives write scale at a permanent complexity cost; it is the last step, not the first.",
      ],
      quiz: [
        {
          question:
            "After moving from one API instance to three behind a load balancer, users report being randomly logged out. What is the most likely cause?",
          options: [
            "The load balancer uses least connections",
            "Sessions are stored in each instance's memory, so other instances do not recognize them",
            "Postgres is out of connections",
            "The JWT secret is too short",
          ],
          answer: 1,
          explanation:
            "In-memory session stores are per-process state. When a request lands on a different instance, the session is missing. Moving sessions to Redis (or using signed tokens) makes the service stateless and fixes it.",
        },
        {
          question:
            "You run 12 API instances with a pool of 20 connections and 8 workers with a pool of 10. Postgres max_connections is 200. What happens under load?",
          options: [
            "Nothing; pools only open connections when needed and never reach the limit",
            "Up to 320 connections are requested, exceeding the limit and causing connection errors; reduce pools or add PgBouncer",
            "Postgres automatically queues extra connections",
            "The load balancer limits connections automatically",
          ],
          answer: 1,
          explanation:
            "12 x 20 + 8 x 10 = 320 potential connections against a limit of 200. Under load, pools fill up and Postgres rejects new connections. Size pools so the total fits with headroom, or multiplex through a pooler like PgBouncer.",
        },
        {
          question:
            "A user saves an invoice and is redirected to the invoice list, which reads from a read replica. The new invoice is missing. What is happening, and what is a good fix?",
          options: [
            "The write failed silently; add retries",
            "Replication lag; route that user's reads to the primary for a short window after a write",
            "The cache is stale; lower the TTL",
            "The replica is corrupted; rebuild it",
          ],
          answer: 1,
          explanation:
            "Async replicas lag the primary by milliseconds to seconds. Read-your-writes consistency (sending a user's reads to the primary briefly after they write) solves the visible symptom without giving up replicas for everyone else.",
        },
        {
          question:
            "Your liveness health check queries Postgres. During a 3-second database failover, what risk does this create?",
          options: [
            "None; health checks are only informational",
            "Every instance fails its check, the load balancer removes all of them, and a brief DB blip becomes a full outage",
            "Postgres gets overloaded by health checks",
            "The failover takes longer",
          ],
          answer: 1,
          explanation:
            "If every instance depends on the same shared resource for liveness, a short outage of that resource marks all instances unhealthy at once. Keep liveness about the process itself, and use readiness checks with care for dependencies.",
        },
        {
          question:
            "A SaaS with 2,000 tenants has one Postgres primary at 40% CPU after query tuning and caching. A teammate proposes sharding by tenant now. What is the best response?",
          options: [
            "Agree; sharding should be done early before data grows",
            "Shard by created_at date instead",
            "Not yet: with headroom left, vertical scaling, replicas and pooling are far cheaper; plan the tenant shard key but defer sharding",
            "Move to a NoSQL database instead",
          ],
          answer: 2,
          explanation:
            "Sharding adds permanent complexity to queries, migrations, backups and analytics. With 60% headroom and cheaper options available, the right move is to defer it while keeping tenant_id on every table so sharding remains possible later.",
        },
      ],
      resources: [
        {
          label: "System Design Primer: Load balancer, Horizontal scaling",
          url: "https://github.com/donnemartin/system-design-primer#load-balancer",
          kind: "web",
        },
        {
          label: "ByteByteGo: Scale from Zero to Millions of Users",
          url: "https://bytebytego.com/courses/system-design-interview/scale-from-zero-to-millions-of-users",
          kind: "web",
        },
        {
          label: "PgBouncer documentation",
          url: "https://www.pgbouncer.org/usage.html",
          kind: "docs",
        },
        {
          label: "Hussein Nasser (YouTube): load balancing and proxies",
          url: "https://www.youtube.com/@hnasr",
          kind: "video",
        },
      ],
    },
    {
      slug: "consistency-concurrency-under-load",
      title: "Consistency and Concurrency Under Load",
      summary:
        "Find and fix race conditions in bidding and reservations with atomic updates, pessimistic and optimistic locking, distributed locks and rate limiting, and understand CAP in plain language.",
      minutes: 55,
      keyTakeaways: [
        "Check-then-act in application code (read, decide, write) is a race condition under concurrency; a transaction at READ COMMITTED does not fix it.",
        "Atomic conditional updates (UPDATE ... WHERE seats_left > 0) plus database constraints are often the simplest correct fix.",
        "Pessimistic locking (SELECT ... FOR UPDATE) serializes access to hot rows; keep locked sections tiny and lock in a consistent order to avoid deadlocks.",
        "Optimistic locking (version column, 409 Conflict) suits rarely contested, human-edited records like invoices.",
        "Redis distributed locks need unique tokens and atomic release, and are an efficiency tool; back correctness with database constraints or fencing tokens.",
        "Rate limit per tenant or API key in Redis and return 429 with Retry-After; under a network partition, choose consistency for money and inventory and availability for feeds and catalogs.",
      ],
      quiz: [
        {
          question:
            "This code runs inside a transaction at READ COMMITTED: SELECT seats_left; if > 0 then UPDATE seats_left = seats_left - 1. Under 200 concurrent requests for the last seat, what happens?",
          options: [
            "Exactly one succeeds because transactions are isolated",
            "Several can succeed because they all read 1 before any of them writes",
            "Postgres throws a serialization error for all but one",
            "All fail with a deadlock",
          ],
          answer: 1,
          explanation:
            "READ COMMITTED does not prevent two transactions from reading the same value and both deciding to proceed. The gap between check and act is the race. Use an atomic conditional UPDATE, FOR UPDATE, or SERIALIZABLE isolation with retries.",
        },
        {
          question:
            "Two accountants occasionally edit the same invoice's notes at the same time, and one overwrites the other's changes. Which approach fits best?",
          options: [
            "SELECT ... FOR UPDATE held while the edit form is open",
            "Optimistic locking with a version column, returning 409 on mismatch",
            "A global Redis lock on the invoices table",
            "Disable concurrent logins",
          ],
          answer: 1,
          explanation:
            "Conflicts are rare and humans are slow, so optimistic locking is ideal: no locks held while users type, and the rare conflict is detected at save time. Holding a row lock for the duration of a form edit would block others for minutes.",
        },
        {
          question:
            "Process A acquires a Redis lock with a 10-second TTL, then pauses for 15 seconds due to a long garbage collection. Process B acquires the lock. What protects correctness when A resumes and writes?",
          options: [
            "Nothing extra is needed; Redis locks are always safe",
            "Releasing the lock with a plain DEL",
            "A database-enforced check such as a unique constraint, version check or fencing token",
            "Increasing the TTL to 60 seconds",
          ],
          answer: 2,
          explanation:
            "A TTL-based lock can expire while its holder still believes it owns it, so both A and B may act. Only the storage layer can reject the stale writer reliably, via constraints, version checks or fencing tokens. Longer TTLs shrink the window but do not eliminate it.",
        },
        {
          question:
            "You implement rate limiting with an in-memory counter in each API process. You run 5 instances with a configured limit of 100 requests per minute per tenant. What is the effective limit?",
          options: [
            "100 per minute",
            "20 per minute",
            "Up to about 500 per minute, because each instance counts separately",
            "Unlimited",
          ],
          answer: 2,
          explanation:
            "Each instance keeps its own counter, so a tenant whose requests are spread across 5 instances can make up to 100 on each. Shared counters in Redis give one consistent limit across the fleet.",
        },
        {
          question:
            "During a network partition between your primary database and a replica region, which features should choose consistency over availability?",
          options: [
            "Product catalog browsing",
            "Activity feed and 'users online' counters",
            "Seat reservations and payment balances",
            "Analytics dashboards",
          ],
          answer: 2,
          explanation:
            "Selling the same seat twice or showing a wrong balance has real cost, so those operations should refuse or wait rather than act on possibly stale data. Catalogs, feeds and analytics tolerate staleness and should stay available.",
        },
      ],
      resources: [
        {
          label: "Redis docs: Distributed locks",
          url: "https://redis.io/docs/latest/develop/use/patterns/distributed-locks/",
          kind: "docs",
        },
        {
          label: "Martin Kleppmann: How to do distributed locking",
          url: "https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html",
          kind: "web",
        },
        {
          label: "ByteByteGo: Design a Rate Limiter",
          url: "https://bytebytego.com/courses/system-design-interview/design-a-rate-limiter",
          kind: "web",
        },
        {
          label: "System Design Primer: CAP theorem",
          url: "https://github.com/donnemartin/system-design-primer#cap-theorem",
          kind: "web",
        },
      ],
    },
    {
      slug: "load-testing-bottlenecks",
      title: "Load Testing and Finding the Bottleneck",
      summary:
        "Write k6 and Artillery load tests with open-model arrival rates, read percentiles and dropped iterations correctly, and use server metrics to find and fix the first bottleneck.",
      minutes: 50,
      keyTakeaways: [
        "Report p95 and p99 latency together with throughput and error rate; averages hide the users having a bad time.",
        "Use open-model executors (constant- or ramping-arrival-rate) to test requests-per-second claims; closed models slow down with the server and hide overload.",
        "Smoke, load, stress, spike and soak tests answer different questions; pick the shape that matches the risk.",
        "The latency knee marks a saturated resource; correlate it with app CPU, event loop lag, DB connections, locks, Redis and queue depth.",
        "Change one thing per run, record config and results, and test the cold-cache path and realistic data volume and skew.",
      ],
      quiz: [
        {
          question:
            "A load test reports average latency 90 ms and p99 latency 3.2 s. A dashboard page makes 20 parallel API calls. What does this mean for users?",
          options: [
            "Users are fine because the average is under 100 ms",
            "A large share of page loads will include at least one 3-second call, so users experience the tail",
            "Only 1% of users are affected",
            "p99 is an outlier and can be ignored",
          ],
          answer: 1,
          explanation:
            "With 20 calls per page, the chance that at least one hits the slowest 1% is about 1 - 0.99^20, roughly 18%. Tail latency compounds across fan-out, which is why p95 and p99 matter far more than averages.",
        },
        {
          question:
            "You run a test with 500 constant VUs that each wait for a response before sending the next request. As the server slows down, what happens to the request rate?",
          options: [
            "It stays constant",
            "It drops, hiding the overload; use an arrival-rate executor to model real traffic",
            "It increases",
            "k6 automatically adds VUs",
          ],
          answer: 1,
          explanation:
            "That is a closed model: slower responses mean each VU sends fewer requests, so load falls exactly when the system struggles. Real users do not wait for each other; arrival-rate executors keep sending at the target rate.",
        },
        {
          question:
            "During a test, every endpoint (including a trivial /health route) slows down together, and Node event loop p99 lag reaches 400 ms. DB CPU is at 30%. Where is the bottleneck most likely?",
          options: [
            "Postgres indexes",
            "Synchronous CPU work blocking the Node event loop in the API process",
            "Redis memory",
            "The network between the load balancer and the API",
          ],
          answer: 1,
          explanation:
            "A trivial route only slows down when the process cannot get to it. High event loop lag with a relaxed database points to CPU-bound synchronous work (large JSON serialization, sync crypto, rendering) in the API.",
        },
        {
          question:
            "Your k6 summary shows thousands of dropped_iterations with a constant-arrival-rate executor. What does that indicate?",
          options: [
            "The test script has a syntax error",
            "k6 could not start iterations on schedule because all VUs were busy; the system is not keeping up with the target rate (or maxVUs is too low)",
            "Requests were dropped by the load balancer",
            "Iterations were deduplicated by k6",
          ],
          answer: 1,
          explanation:
            "Dropped iterations mean the arrival rate exceeded what the available VUs could sustain, usually because responses are slow. It is a direct overload signal, though you should confirm maxVUs and the load generator's own CPU are not the limit.",
        },
        {
          question:
            "Your load test hits the same product ID on every request and shows p95 of 4 ms. Why should you distrust this result?",
          options: [
            "k6 is inaccurate below 10 ms",
            "It measures only the cache hit path; realistic tests need a distribution of keys, hot-key skew and a cold-cache run",
            "Product endpoints should always be slow",
            "p95 is the wrong metric",
          ],
          answer: 1,
          explanation:
            "A single key gives a near 100% hit ratio and never exercises the database or cache misses. Model realistic key distribution and skew, and run once with an empty cache to see how the system behaves after a deploy or failover.",
        },
      ],
      resources: [
        {
          label: "k6 documentation",
          url: "https://grafana.com/docs/k6/latest/",
          kind: "docs",
        },
        {
          label: "k6: Open and closed models",
          url: "https://grafana.com/docs/k6/latest/using-k6/scenarios/concepts/open-vs-closed/",
          kind: "docs",
        },
        {
          label: "Artillery documentation",
          url: "https://www.artillery.io/docs",
          kind: "docs",
        },
      ],
    },
  ],
  problems: [
    {
      slug: "redis-handshake",
      title: "Redis Handshake",
      kind: "exercise",
      summary:
        "Put a cache-aside Redis layer with an explicit 60-second TTL in front of an expensive tenant metadata query, then measure hits, misses and stampede behavior.",
      estimatedHours: 4,
      needsDiagram: false,
      requirements: [
        "getTenantMetadata(tenantId) checks Redis first and returns the parsed payload on a hit.",
        "On a miss it runs the slow read and writes the result with SET ... EX 60 in a single command, then returns it.",
        "Keys follow the format tenant:{id}:metadata:v1 and every key written has a TTL.",
        "invalidateTenantMetadata(tenantId) deletes the key, and the next read is a MISS with fresh data.",
        "If Redis is stopped or times out, the function logs the error and returns correct data from the database without throwing.",
        "A benchmark prints cold and warm p50/p95 for 100 calls, and the hit ratio computed from Redis INFO stats.",
        "A stampede test shows how many times the loader ran for 200 concurrent misses, before and after adding single-flight.",
      ],
      hints: [
        "Start with the simplest version: GET, and on null, load and SET. Log HIT or MISS with a timing for each call before optimizing anything.",
        "ioredis supports redis.set(key, value, 'EX', 60) so the value and TTL are written atomically; avoid a separate EXPIRE call that could be skipped if the process dies.",
        "For Redis failure handling, set a short commandTimeout and maxRetriesPerRequest on the client, and wrap cache calls in try/catch that falls through to the loader.",
        "For single-flight, try redis.set(lockKey, '1', 'PX', 5000, 'NX'); the request that gets 'OK' loads and populates the cache, others poll the cache every 50 ms for a short time before falling back to loading.",
      ],
      rubric: [
        "Could two tenants ever receive each other's cached data with my key scheme?",
        "Is there any code path that writes a key without a TTL?",
        "Does my app still return correct data with Redis completely down?",
        "Do my measured numbers support the claim that the cache helps, and are they reported as percentiles?",
        "Did I prove, not assume, that single-flight reduced the loader count?",
      ],
      stretchGoals: [
        "Implement stale-while-revalidate: store a soft expiry in the payload and refresh in the background while serving stale data.",
        "Add TTL jitter and demonstrate with 1,000 warmed keys that expirations spread out instead of happening at once.",
        "Store the metadata as a Redis hash and update a single field on settings change instead of deleting the whole entry.",
      ],
      repoChecklist: [
        "Source for getTenantMetadata, invalidation and the single-flight helper in TypeScript.",
        "docker-compose.yml or documented command to run Redis locally.",
        "Benchmark and stampede scripts runnable with one npm script each.",
        "README with a results table: cold vs warm p50/p95, hit ratio, loader count before and after single-flight.",
        "A short note on the Redis-down behavior and how you tested it.",
      ],
      relatedLessons: ["caching-layers", "load-testing-bottlenecks"],
    },
    {
      slug: "asynchronous-buffer",
      title: "The Asynchronous Buffer",
      kind: "exercise",
      summary:
        "Turn a slow synchronous image-processing endpoint into a 202 Accepted API backed by a BullMQ queue and a separate worker with retries, idempotency and a dead-letter path.",
      estimatedHours: 8,
      needsDiagram: true,
      designPrompt:
        "Draw the end-to-end asynchronous flow for one image upload with numbered arrows: Client -> API (validate, store original) -> Object storage; API -> Database (image record, status queued); API -> Queue (job with IDs only); API -> Client (202 Accepted + status URL). Then Queue -> Worker pool (separate processes, labeled with concurrency) -> Object storage (three variants) -> Database (status ready). Show the retry loop with exponential backoff, the dead-letter/failed set with an alert and replay arrow, and the client polling GET /api/images/:id until ready.",
      requirements: [
        "POST /api/images returns 202 with imageId, a statusUrl and a Location header, with p95 under 300 ms for 100 parallel uploads (excluding upload transfer).",
        "The API process never imports or calls sharp; all processing runs in a separate worker process.",
        "Job payloads contain only IDs and storage keys and are under 1 KB.",
        "GET /api/images/:id returns queued, processing, ready or failed with progress, and enforces tenant ownership.",
        "Jobs retry at least 4 times with exponential backoff; unsupported or corrupt files fail permanently after one attempt.",
        "Killing the worker with kill -9 mid-batch and restarting it results in every image reaching ready with exactly three variants and no duplicates.",
        "A script lists failed (dead-lettered) jobs with their error and can replay a single job.",
        "The worker handles SIGTERM by finishing in-flight jobs before exiting.",
      ],
      hints: [
        "Sketch the diagram first. Decide what the API does (validate, store, record, enqueue, respond) and what it must not do (anything CPU-heavy).",
        "Use deterministic storage keys like tenants/{tenantId}/images/{imageId}/{variant}.webp so a re-run overwrites rather than duplicates. That is most of your idempotency.",
        "In BullMQ, set attempts and backoff in defaultJobOptions, and throw UnrecoverableError for invalid images so they skip retries. Keep removeOnFail false so failures remain inspectable.",
        "For progress, call job.updateProgress after each variant; the status endpoint can read job state with queue.getJob(id) or from the images table that the worker updates.",
        "To test resilience, wrap your storage write in a function that throws randomly 30% of the time behind an environment flag, then watch attempts climb in the logs.",
      ],
      rubric: [
        "Does the diagram match what the code actually does, including the failure path?",
        "If the same job runs twice, can I prove the end state is identical?",
        "Is the worker concurrency justified by CPU cores and memory per job, not picked at random?",
        "Can a user from tenant A learn anything about tenant B's images through the status endpoint?",
        "Do I alert or at least surface jobs that exhausted retries, or would they rot silently?",
      ],
      stretchGoals: [
        "Replace polling with Server-Sent Events that push status changes to the client.",
        "Add a priority lane so single uploads are processed ahead of bulk imports.",
        "Autoscale workers locally by running a script that adds worker processes when queue depth exceeds a threshold.",
        "Generate presigned upload URLs so the file goes directly from the browser to storage and the API only receives the key.",
      ],
      repoChecklist: [
        "API and worker as separate entry points with separate npm start scripts.",
        "docker-compose.yml for Redis, Postgres and optional MinIO.",
        "Exported architecture diagram (PNG or SVG) of the async flow.",
        "Load script uploading 100 images in parallel and printing p95 and drain time.",
        "README documenting the retry policy, idempotency strategy, concurrency choice and the kill -9 test result.",
      ],
      relatedLessons: ["message-queues-background-workers", "system-design-framework"],
    },
    {
      slug: "erp-pdf-report-service",
      title: "Design an ERP PDF Report Generation Service for 100k Users",
      kind: "design",
      summary:
        "Design a PDF generation service that renders invoices quickly, handles 2,000-page financial reports and the month-start statement batch, and never slows the main ERP API.",
      estimatedHours: 6,
      needsDiagram: true,
      designPrompt:
        "Draw the full architecture: client, load balancer, main ERP API, a report request endpoint returning 202, separate queues or priority lanes for small documents, statement batches and heavy reports, distinct worker pools for each with their sizing labeled, the database holding job and report records, object storage with retention lifecycle rules, a CDN or signed-URL download path, and the completion notification path (polling, websocket or email). Show the month-start statement fan-out (scheduler -> batch job -> per-customer jobs -> completion tracking), the autoscaling signal (queue depth or oldest job age), and the dead-letter path with alerting.",
      requirements: [
        "DESIGN.md states functional and non-functional requirements and at least three explicitly out-of-scope items.",
        "Estimations show the arithmetic for documents per second (average and month-start peak), storage for 1 year and 7 years, and egress bandwidth.",
        "Worker capacity for each document class is computed with Little's Law and checked against the 5-second and 10-minute p95 targets.",
        "The API contract lists request, status and download endpoints with HTTP status codes, including 202 Accepted.",
        "At least three deep dives are written, including queue priority/isolation and one of tenant fairness or the statement batch.",
        "A trade-offs and failure-modes table has at least five rows, each stating what the user sees.",
        "The exported diagram matches the document and every component is justified by a requirement or a number.",
      ],
      hints: [
        "Start from the estimates. Separate the three document classes; they differ by 100x in render time and memory, which strongly suggests they should not share a queue or a worker pool.",
        "Compute statement batch volume: 3,000 companies x 400 customers = 1.2 million statements on the 1st. At 800 ms each, how many worker-seconds is that, and how many workers finish it in, say, 4 hours?",
        "For tenant fairness, consider per-tenant concurrency limits or round-robin across per-tenant queues so one company's 3,000 reports do not block everyone else.",
        "For heavy reports, think about memory isolation (one render per container, hard memory limits), timeouts, and chunking: render sections in parallel and merge, so a crash at page 1,900 does not restart from page 1.",
        "For delivery, store PDFs in object storage under deterministic keys, apply lifecycle rules for 90-day vs 7-year retention, and hand out short-lived signed URLs rather than streaming through the API.",
      ],
      rubric: [
        "Can every number in my document be traced to the given scale or a stated assumption?",
        "Does a heavy report ever share a worker with an invoice a customer is waiting for?",
        "What exactly happens at 9:00 a.m. on the first business day of the month, and does my capacity math cover it?",
        "Are issued legal documents immutable and retained for 7 years in my design?",
        "Have I removed every component I cannot justify?",
        "If the queue or object storage is down, does the main ERP still work?",
      ],
      stretchGoals: [
        "Estimate monthly infrastructure cost for your design and propose a cheaper variant with its trade-offs.",
        "Design caching of identical reports (same tenant, parameters and data version) to avoid re-rendering.",
        "Add a multi-region disaster recovery section with RPO and RTO targets.",
      ],
      repoChecklist: [
        "DESIGN.md following the requirements, estimations, high-level design, deep dives, trade-offs, 10x structure.",
        "Exported architecture diagram (PNG or SVG) referenced from DESIGN.md.",
        "An estimations section or appendix showing all arithmetic.",
        "API contract (endpoints, payloads, status codes) in DESIGN.md or a separate file.",
        "A README linking to the design and summarizing the three most important decisions.",
      ],
      relatedLessons: [
        "system-design-framework",
        "message-queues-background-workers",
        "horizontal-vertical-scaling",
        "caching-layers",
      ],
    },
    {
      slug: "multi-tenant-notification-system",
      title: "Design a Multi-Tenant SaaS Notification System",
      kind: "design",
      summary:
        "Design a notification service for 5,000 tenants that delivers email, in-app, Slack and SMS reliably, respects provider rate limits and user preferences, and keeps urgent messages fast during digest floods.",
      estimatedHours: 6,
      needsDiagram: true,
      designPrompt:
        "Draw the notification pipeline: product services calling a single notify API, an ingestion step that validates, deduplicates by idempotency key and persists the notification, a preference/routing step (with a preference cache), fan-out into per-channel queues separated by priority (security, transactional, digest), per-channel worker pools with token-bucket rate limiters for each provider and per webhook, the external providers (email, SMS, Slack/Teams), a delivery log table, retry and dead-letter paths, the in-app path (database store, unread counts, real-time push via Redis pub/sub to horizontally scaled API instances), and the scheduler that triggers the Monday digest per timezone.",
      requirements: [
        "DESIGN.md states functional and non-functional requirements, including per-priority delivery targets, and what is out of scope.",
        "Estimations show average and peak notifications per second per channel, the Monday digest burst, the 30,000-user announcement and history storage for a stated retention period.",
        "The doc answers with arithmetic whether 500 emails/second absorbs digest plus transactional traffic within the targets, and what happens if not.",
        "The internal notify API and data model (notifications, deliveries, preferences, templates) are specified, including the idempotency key.",
        "At least three deep dives, including priority isolation and either external rate limiting or tenant fairness.",
        "A failure-modes table with at least five rows covers provider outage, queue backlog and duplicate delivery, each with what the user and tenant admin observe.",
        "The exported diagram shows separate priority paths and every component maps to a requirement or a number.",
      ],
      hints: [
        "Begin with the Monday problem: 250,000 digests within 2 hours at 500 emails/second shared with transactional traffic. Compute the required rate and the remaining headroom first.",
        "Priority isolation usually means physically separate queues and worker pools (or reserved rate-limit capacity) for security notifications, not just a priority number on the same queue.",
        "Fan out in two stages: one job expands an event into recipient batches (for example 500 recipients each), then per-recipient-per-channel delivery jobs. This keeps any single job small and retryable.",
        "Make delivery idempotent with a unique (notification_id, user_id, channel) row in a deliveries table, and pass the same key to providers that support idempotency headers.",
        "For in-app real time across many API instances, the instance that holds a user's websocket may not be the one that processed the notification; Redis pub/sub or a managed realtime service bridges that gap.",
      ],
      rubric: [
        "Can a password reset be delayed by the Monday digest or by a 30,000-user announcement in my design?",
        "Do I respect both the provider-wide 500/s limit and per-webhook limits, and what happens on a 429?",
        "Is there any path where a retried job sends a duplicate email or SMS?",
        "Where are preferences and quiet hours evaluated, and what happens if the preference cache is stale?",
        "Is every delivery attempt traceable for a support engineer answering 'did the customer get this email?'",
      ],
      stretchGoals: [
        "Add provider failover: a second email provider with health-based routing and the trade-offs it introduces.",
        "Design notification batching ('5 invoices need approval' instead of 5 emails) with a short aggregation window.",
        "Add per-tenant usage metering so notification volume can be billed or capped by plan.",
      ],
      repoChecklist: [
        "DESIGN.md with requirements, estimations, high-level design, deep dives, trade-offs and 10x section.",
        "Exported architecture diagram (PNG or SVG) referenced from DESIGN.md.",
        "Data model and notify API contract.",
        "Failure-modes table and a traced walkthrough of a password reset during the Monday peak.",
        "A README summarizing the key decisions and linking to the design.",
      ],
      relatedLessons: [
        "system-design-framework",
        "message-queues-background-workers",
        "consistency-concurrency-under-load",
        "caching-layers",
      ],
    },
    {
      slug: "high-traffic-saas-simulation",
      title: "The High-Traffic SaaS Simulation",
      kind: "capstone",
      summary:
        "Design, build and load test a live bidding (or reservation) backend that absorbs 5,000 requests per second with p95 under 200 ms and zero incorrect outcomes, using Redis caching and queued side effects.",
      estimatedHours: 30,
      needsDiagram: true,
      designPrompt:
        "Draw the target architecture before coding and an updated version after load testing: the k6 load generator on separate hardware, the load balancer, at least two stateless API instances, Redis (cache for lot reads, rate limiter, and any gatekeeper script), Postgres primary (source of truth for bids) with a connection pooler, BullMQ queues for notifications, audit and analytics, the worker pool, and the dead-letter path. Annotate the bid write path step by step showing where atomicity is enforced, annotate the read path with cache hit/miss and stampede protection, and label each component with the metric you watched during load tests and its value at peak.",
      requirements: [
        "GET /api/lots/:id serves from Redis via cache-aside with TTLs and stampede protection, falling back to Postgres.",
        "POST /api/lots/:id/bids accepts or rejects atomically and returns 409 for invalid or outbid bids; the chosen concurrency approach is justified in the README.",
        "Notifications, audit enrichment and analytics run in BullMQ workers with retries, idempotent handlers and a dead-letter path; no external calls happen in the bid request.",
        "At least two stateless API instances run behind a load balancer, with pool sizes documented and the total connection count shown to fit the database limit.",
        "Per-user bid rate limiting returns 429 with a Retry-After header.",
        "A k6 script with arrival-rate executors models the 80/20 read/write mix and hot-lot skew, and passes thresholds of p95 under 200 ms and errors under 1% for at least 5 minutes at the documented target rate.",
        "A correctness verifier run after each load test reports zero violations, including after Redis is flushed mid-test.",
        "RESULTS.md records at least three iterations of measure, identify bottleneck, change one thing, re-measure, with RPS, p50, p95, p99 and error rate.",
      ],
      hints: [
        "Do the estimation first: 5,000 req/s at 80/20 is 4,000 reads and 1,000 bids per second, and the top 5 lots get 60%. That is about 120 bids/s on each hottest lot. Ask how long your write holds a row lock and whether 120/s per row fits.",
        "Get correctness right before speed. Build the verifier early, run a 200-concurrent-bid test with Promise.all, and only then start load testing.",
        "An atomic conditional UPDATE (UPDATE lots SET price = $2, leader = $3, version = version + 1 WHERE id = $1 AND price < $2 AND ends_at > now()) is often enough and keeps the locked section to a single statement.",
        "If Postgres row contention on hot lots is your bottleneck, a Redis Lua script can act as a fast gatekeeper that rejects clearly losing bids before they reach the database, while Postgres remains the source of truth for accepted bids.",
        "When the numbers stall, watch event loop lag, pool wait time, pg_stat_activity wait events and Redis CPU during the run. Change one thing, rerun the identical script and log the result.",
      ],
      rubric: [
        "Would my correctness verifier catch an oversold seat or a lower bid winning, and did it pass after every run?",
        "Are my load test numbers produced with an open model, realistic skew and a load generator that was not itself saturated?",
        "Can I name the first bottleneck I hit, the evidence for it and the change that moved it?",
        "If Redis is flushed or an API instance dies mid-test, does the system recover without incorrect outcomes?",
        "Does my diagram reflect what I actually built, including the changes made during load testing?",
        "Have I reported my results honestly, including the rate at which I could not meet the target?",
      ],
      stretchGoals: [
        "Push live price updates to clients via Server-Sent Events with Redis pub/sub across API instances, and load test concurrent connections.",
        "Add a Postgres read replica for lot history pages and handle read-your-writes for the bidder who just placed a bid.",
        "Run a 1-hour soak test and show memory, connection counts and queue depth stay flat.",
        "Add anti-sniping: extend an auction's end time when a bid arrives in the final 30 seconds, and prove it stays correct under load.",
      ],
      repoChecklist: [
        "Source for the API, workers, Lua scripts (if any) and correctness verifier in TypeScript.",
        "docker-compose.yml bringing up the load balancer, two or more API instances, workers, Redis, Postgres and the pooler.",
        "k6 (or Artillery) scripts with thresholds and instructions for running them.",
        "Before and after architecture diagrams exported as PNG or SVG.",
        "RESULTS.md with the iteration table and committed k6 summary output.",
        "README explaining the concurrency strategy, caching strategy, queue design and how to reproduce the results.",
      ],
      relatedLessons: [
        "system-design-framework",
        "caching-layers",
        "message-queues-background-workers",
        "horizontal-vertical-scaling",
        "consistency-concurrency-under-load",
        "load-testing-bottlenecks",
      ],
    },
  ],
  sources: [
    {
      label: "ByteByteGo by Alex Xu",
      url: "https://bytebytego.com",
      kind: "web",
    },
    {
      label: "Hussein Nasser (YouTube)",
      url: "https://www.youtube.com/@hnasr",
      kind: "video",
    },
    {
      label: "Clément Mihailescu (YouTube)",
      url: "https://www.youtube.com/c/ClementMihailescu",
      kind: "video",
    },
    {
      label: "System Design Primer",
      url: "https://github.com/donnemartin/system-design-primer",
      kind: "web",
    },
  ],
};
