## Scenario

You are the lead engineer of a mid-size ERP company. Everything runs on a single managed Postgres primary (16 vCPU, 128 GB RAM, 2 TB gp3 storage at 12,000 IOPS) with one synchronous standby for failover. No replicas, no pooler, no caching beyond the browser. The database is now the system's bottleneck in three different ways, and leadership has asked for one design document that addresses all three without a rewrite.

### Profile 1: the 9 a.m. dashboard rush

- 1,800 tenants, about 25,000 daily users.
- Between 08:45 and 09:30 local time (most tenants share two timezones), users open the home dashboard: 8 tiles (revenue this month, overdue receivables, top customers, stock alerts, and so on). Each tile is one aggregate query over invoices (90 million rows total), invoice lines (600 million) or stock movements.
- Peak: 1,200 dashboard loads per minute, so about 160 tile queries per second, each with a median of 180 ms and p95 of 2.5 s. Outside the peak, about 15 tile queries per second.
- During the peak, database CPU sits at 95%, and ordinary writes (creating invoices) slow from 8 ms to 600 ms.
- Data only needs to be fresh to within a few minutes on the dashboard. Overdue receivables must reflect a payment the user just recorded.

### Profile 2: warehouse scan ingestion

- Handheld scanners and conveyor IoT sensors in 140 warehouses post scan events (`tenant_id, warehouse_id, device_id, sku, location, event_type, scanned_at, payload jsonb`, about 300 bytes per row on disk with indexes).
- Average 5,000 inserts per second, bursts to 12,000 per second during shift changes. Currently one `INSERT` and one commit per event, straight from the API.
- The table has 6 B-tree indexes, including the primary key on a UUID v4 `id`. It is 1.4 TB and growing fast (the conveyor sensors that pushed volume to today's rate went live three weeks ago); nothing is ever deleted.
- Consumers: a "where is this pallet now" lookup (latest event per pallet, must be under 1 s fresh), hourly throughput charts per warehouse, and a 13-month audit requirement for raw events.
- Autovacuum on this table never finishes, and WAL generation causes the standby to lag.

### Profile 3: one whale tenant

- Multi-tenant SaaS with shared tables and `tenant_id` on every row.
- One tenant, a national distributor, holds 40% of all rows and generates 35% of query load. The next largest tenant holds 3%.
- The whale's month-end close runs reports that saturate I/O for 40 minutes, and the small tenants' p95 triples during that window.
- The whale is asking for contractual data isolation and a 99.95% SLA; smaller tenants are price sensitive.

## What to build

A `DESIGN.md` plus diagrams (use the whiteboard; export images into the repo):

1. **Diagnosis per profile.** Which resource saturates, and the evidence you would collect to confirm it (name the views or metrics and the specific numbers you would expect to see).
2. **Strategy per profile**, chosen from the scaling playbook and applied in order. For each strategy: why it addresses this bottleneck, what it costs (money, complexity, operational burden), and what it does *not* fix.
3. **Back-of-envelope numbers** for each profile: for example, connections needed via Little's law, rows and bytes per day, partition sizes, replica count, expected query time after the change, storage after retention.
4. **A target architecture diagram for each profile** (three diagrams, or one diagram with three clearly separated regions).
5. **A migration path** from today's single Postgres to the target, as numbered phases. Each phase is independently shippable, has a rollback, and states the metric that proves it worked before you start the next.
6. **What you are deliberately not doing**, and the trigger that would make you do it (for example: "no sharding until the primary's write IOPS exceeds 70% at peak after partitioning and batching").

## Constraints

- Postgres stays the system of record for transactional data. You may add other stores for derived data.
- Budget: you may at most double the current monthly database spend for Profiles 1 and 2 combined. The whale (Profile 3) may have dedicated infrastructure if its contract pays for it; say how.
- No downtime longer than 5 minutes for any migration phase. Large table changes must be online.
- Read-after-write consistency is required for a user's own payments and stock moves; everything else may be stale by up to 5 minutes unless you justify otherwise.
- Every strategy must say how you would roll it back.

## How to measure and verify

This is a design problem, so verification means the document is testable:

- Each profile has at least two numeric success criteria, for example "dashboard tile p95 under 300 ms at 160 queries per second" or "ingestion sustains 12,000 events per second for 10 minutes with standby replay lag under 5 s".
- Each number you rely on is either derived in the document (show the arithmetic) or labelled as an assumption you would verify, with how.
- Optional but valuable: build a small benchmark for Profile 2 in Docker comparing single-row inserts, multi-row inserts of 1,000 rows, and `COPY`, and report rows per second for each on your machine. Use the result to sanity-check your ingestion design.
