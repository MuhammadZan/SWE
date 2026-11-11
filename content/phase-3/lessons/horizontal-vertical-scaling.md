## Why this matters

Your SaaS runs on one VM: Node, Postgres and Redis on a 4 vCPU / 16 GB box. It has been fine for two years. Then you sign a customer with 3,000 employees, and every Monday morning CPU sits at 95%, response times hit 4 seconds, and a single kernel update reboot means total downtime.

You have two options. Buy a bigger machine (vertical scaling) or run several machines and spread the load (horizontal scaling). Both are legitimate. Knowing when to use which, and what you must change in your code to make horizontal scaling possible, is a core professional skill.

## Vertical scaling: a bigger box

Vertical scaling means more CPU, RAM, faster disks on the same machine.

**Pros**

- Zero code changes. Click resize, reboot, done.
- No distributed systems problems: one process, one memory space, one database.
- Surprisingly far-reaching. A single modern cloud database server with 64 cores and 512 GB RAM can handle a very large SaaS.

**Cons**

- **Ceiling.** There is a biggest machine, and the price curve gets steep near the top.
- **Single point of failure.** One machine means one failure takes you down.
- **Downtime to resize** in many setups.
- Node.js runs your JavaScript on one thread per process, so a 32-core box does nothing for a single Node process. You must run multiple processes anyway (cluster mode or PM2), which is already a step toward horizontal thinking.

Vertical scaling is the right first move for databases, which are hard to scale horizontally. It is usually the wrong long-term move for stateless application servers, which are easy to scale horizontally.

## Horizontal scaling: more boxes

Horizontal scaling means running N identical copies of a service behind a **load balancer**.

```
                       +----------------+
   Clients ----------> | Load Balancer  |  (health checks every 5 s)
                       +----------------+
                       /       |        \
                      v        v         v
                 +-------+ +-------+ +-------+
                 | API 1 | | API 2 | | API 3 |   identical, stateless
                 +-------+ +-------+ +-------+
                      \        |        /
                       v       v       v
                  +--------------------------+
                  |  Shared state:           |
                  |  Postgres, Redis, S3     |
                  +--------------------------+
```

**Pros**

- Near-linear capacity growth for stateless work: 3 instances handle roughly 3x the traffic.
- Redundancy: one instance dies, the load balancer stops routing to it, users notice nothing.
- Zero-downtime deploys: replace instances one at a time (rolling deploy).
- Autoscaling: add instances at 9 a.m., remove them at night.

**Cons**

- Your code must be **stateless** (next section).
- The shared dependencies (database, Redis) now receive connections and load from all instances. You moved the bottleneck, you did not remove it.
- More moving parts to monitor.

## Load balancers

A load balancer accepts incoming connections and forwards each one to a healthy backend.

### Layer 4 vs Layer 7

- **L4 (transport):** routes TCP connections by IP and port without reading the HTTP content. Very fast, cannot route by URL. Example: AWS NLB.
- **L7 (application):** understands HTTP. Can route `/api/*` to one pool and `/reports/*` to another, terminate TLS, add headers, do sticky sessions by cookie. Examples: Nginx, HAProxy, AWS ALB, Cloudflare.

Most web apps use L7.

### Algorithms

| Algorithm | How it works | Good for |
| --- | --- | --- |
| Round robin | Next request to next server in turn | Uniform, short requests |
| Least connections | Send to the server with fewest active connections | Mixed request durations (report endpoints next to fast ones) |
| IP hash / consistent hash | Same client or key always goes to same server | Cache locality, simple stickiness |
| Weighted | Bigger servers get more traffic | Mixed instance sizes, canary deploys |

### Health checks

The load balancer periodically calls an endpoint like `GET /healthz`. If it fails N times, the instance is removed from rotation.

```ts
// Liveness: is the process alive?
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

// Readiness: can it serve traffic? (checked before routing traffic to a new instance)
app.get("/readyz", async (_req, res) => {
  try {
    await Promise.all([db.query("SELECT 1"), redis.ping()]);
    res.status(200).send("ready");
  } catch {
    res.status(503).send("not ready");
  }
});
```

Be careful making liveness depend on the database: if Postgres blips, every instance fails its check, the load balancer removes all of them, and a 2-second database hiccup becomes a full outage.

A minimal Nginx config. Note that open-source Nginx only does **passive** health checks (`max_fails`: it stops routing to a server after real requests to it fail); active polling of `/healthz` needs HAProxy, a cloud load balancer or NGINX Plus.

```nginx
upstream api {
  least_conn;
  server 10.0.1.11:3000 max_fails=3 fail_timeout=10s;
  server 10.0.1.12:3000 max_fails=3 fail_timeout=10s;
  server 10.0.1.13:3000 max_fails=3 fail_timeout=10s;
  keepalive 64;
}

server {
  listen 80;   # in production: listen 443 ssl; plus ssl_certificate and ssl_certificate_key
  location / {
    proxy_pass http://api;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

## Stateless services

A service is **stateless** when any instance can handle any request because nothing important lives only in that instance's memory or disk. Things that break statelessness, and where they should go instead:

| Hidden state | Problem | Move it to |
| --- | --- | --- |
| In-memory sessions (`express-session` default MemoryStore) | User logs in on API 1, next request hits API 2, logged out | Redis session store or stateless JWT |
| Uploaded files on local disk | Upload hits API 1, download hits API 2: 404 | Object storage (S3, R2) |
| In-memory cache (`const cache = new Map()`) | Each instance has a different, inconsistent cache | Redis (or accept per-instance caching for truly static data) |
| `setInterval` cron jobs in the API | Runs N times with N instances | A scheduler with a single leader, or a queue's repeatable jobs |
| In-memory rate limit counters | Limit is effectively N times higher | Redis counters |
| WebSocket connections | A message for user X must reach the instance holding X's socket | Redis pub/sub or a managed realtime service |

The test: "If I kill this instance right now and start a new one, does any user lose anything?" If the answer is no, it is stateless.

## Sessions and sticky sessions

**Sticky sessions** (session affinity) tell the load balancer to send the same user to the same instance, usually via a cookie. It is a quick fix for in-memory sessions, but it has costs:

- When that instance dies or is deployed, its users lose their sessions.
- Load becomes uneven: one heavy tenant pinned to one instance.
- Autoscaling helps less, because existing users stay on old instances.

Prefer real statelessness: store sessions in Redis (`connect-redis`) or use signed tokens. Reserve sticky sessions for cases where they genuinely help, such as WebSocket connections that need to stay on the instance holding them.

## Scaling the database

Once the app tier is stateless and horizontally scaled, the database is usually the next bottleneck. Options, roughly in the order you should consider them:

1. **Fix queries and indexes** (Phase 2). Often a 10–100x win for free.
2. **Cache** hot reads (previous lesson).
3. **Scale up** the database vertically.
4. **Connection pooling.**
5. **Read replicas.**
6. **Partitioning and sharding.**

### Connection pooling

Every Postgres connection is a separate OS process using several MB of memory. Default `max_connections` is 100. Do the math: 10 API instances x a pool of 20 = 200 connections, plus 10 workers x 10 = 300. Postgres refuses connections, and you get `sorry, too many clients already` errors under load.

Fixes:

- Size app pools deliberately. Total across all instances must stay under the database limit with headroom.
- Put **PgBouncer** (or a managed pooler such as RDS Proxy, Supabase's pooler, Neon's pooler) between apps and Postgres. In transaction mode, thousands of client connections share a few dozen real ones.

```
 20 API instances x 50 client conns       PgBouncer           Postgres
 = 1,000 client connections        --->  (transaction mode) ---> 40 server connections
```

Caveat: transaction-mode pooling breaks session-level features like `SET` statements, advisory locks held across transactions, and some prepared statement setups. Know what your ORM does.

### Read replicas

A replica is a copy of the primary database that receives a continuous stream of changes and serves read-only queries.

```
          writes                     reads
 API ---------------> Primary ---replication---> Replica 1  <------ reports, dashboards
                         |                       Replica 2  <------ search, lists
                         +------ async, lag 10 ms to seconds
```

Great for read-heavy SaaS: send reports, dashboards and list pages to replicas. The catch is **replication lag**. A user saves an invoice (write to primary), the page redirects to the invoice list (read from replica), and the new invoice is not there yet. Solutions:

- **Read-your-writes:** after a user writes, route that user's reads to the primary for a few seconds (track a timestamp in the session).
- Route anything immediately following a write to the primary.
- Never read from a replica to make a decision that must be consistent (stock check, balance check).

### Sharding, briefly

**Sharding** splits data across multiple independent databases, each holding a subset of rows. For a multi-tenant SaaS, the natural shard key is `tenant_id`: tenants 1–1,000 on shard A, 1,001–2,000 on shard B, or better, a lookup table mapping tenant to shard so you can move big tenants.

```
            +----------------+
  API ----> | tenant -> shard|  (lookup or hash)
            +----------------+
             /       |       \
          Shard A  Shard B  Shard C   (each a full Postgres with replicas)
```

Sharding gives near-unlimited write scale, but it costs a lot: cross-shard queries and joins become application code, cross-shard transactions mostly disappear, rebalancing is a project, and every tool (migrations, backups, analytics) must handle N databases. Most SaaS companies never need it. Do it last, after you have exhausted the options above, and choose the shard key so that almost every query hits exactly one shard.

## Common mistakes

- **Scaling the app tier and melting the database.** Ten instances with big pools exhaust Postgres connections. Always recompute total connections.
- **In-memory state discovered in production.** Sessions, uploads, cron jobs and rate limiters that worked on one box break silently on three.
- **Liveness checks that depend on shared dependencies.** One database blip removes every instance from the load balancer.
- **Reading your own writes from a replica.** Users report "my data disappeared" bugs that nobody can reproduce.
- **Sharding too early.** It is a one-way door with a permanent complexity tax.
- **Assuming a bigger Node box helps.** A single Node process uses one core for JavaScript. Run one process per core.

## In the real world

A typical mid-size SaaS: a managed load balancer, 3–20 stateless app containers with autoscaling, a separate worker fleet, one large managed Postgres primary with one or two replicas, PgBouncer, a Redis cluster, and object storage. That stack serves millions of users. Companies like GitHub and Shopify ran on vertically scaled MySQL primaries for years before sharding, and Shopify famously shards by shop (tenant) into "pods". The lesson: scale the app tier horizontally early because it is cheap, and scale the database vertically for as long as you can because the alternative is expensive.

## Try it

1. Run three copies of a small Express app on ports 3001–3003 behind a local Nginx using the config above. Add a response header with the instance's port and watch requests rotate.
2. Add `express-session` with the default memory store and log in. Refresh several times. Watch yourself get logged out. Switch to `connect-redis` and confirm it is fixed.
3. Kill one instance while firing requests with a loop. Observe how many errors you see before Nginx marks it down, then tune `max_fails` and `fail_timeout`.
4. Calculate: 12 API instances with a pool size of 15 and 6 workers with a pool size of 10. Will this fit in `max_connections = 200` with 20 reserved for admin? What would PgBouncer change?
5. On the whiteboard, draw your current production setup and then a version that survives the loss of any single machine.
