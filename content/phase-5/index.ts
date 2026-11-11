import type { PhaseMeta } from "@/lib/types";
import { lessonsA, problemsA } from "./part-a";
import { lessonsB, problemsB } from "./part-b";

const capstones = [...problemsA, ...problemsB].filter((p) => p.kind === "capstone");
const others = [...problemsA, ...problemsB].filter((p) => p.kind !== "capstone");

export const phase: PhaseMeta = {
  id: 5,
  slug: "databases-production",
  title: "Databases in Production",
  tagline: "Data modeling, transactions, scaling by bottleneck, migrations, recovery and security",
  objective:
    "Run the database like an owner: model data that protects the business, diagnose which resource is actually the bottleneck, pick the scaling strategy that fits the load, and keep it safe, recoverable and observable.",
  overview:
    "Phase 2 taught you to make individual queries fast. This phase is about the database as a production system. Most serious SaaS outages and data incidents trace back to it: a migration that locked a hot table, a connection storm, a replica that lagged, a backup nobody had tested, a tenant who could read another tenant's rows.\n\nThe first half is design and diagnosis. You model data so the database enforces business rules, learn exactly what each isolation level allows, and build a repeatable method for finding the saturated resource (CPU, I/O, locks, connections) before reaching for a fix. Then you work through the scaling playbook in the order professionals use it, from query fixes and pooling to replicas, partitioning and sharding, and learn to match the strategy to the load profile.\n\nThe second half is operations: schema changes without downtime, backups you have actually restored, failover, least-privilege access with row-level security, and the maintenance and monitoring that keep Postgres healthy over years. The capstone puts all of it into one production-ready stack.",
  lessons: [...lessonsA, ...lessonsB],
  problems: [...others, ...capstones],
  sources: [
    { label: "PostgreSQL Documentation", url: "https://www.postgresql.org/docs/current/", kind: "docs" },
    { label: "Designing Data-Intensive Applications by Martin Kleppmann", url: "https://dataintensive.net/", kind: "book" },
    { label: "Use The Index, Luke", url: "https://use-the-index-luke.com/", kind: "web" },
    { label: "PgBouncer documentation", url: "https://www.pgbouncer.org/", kind: "docs" },
  ],
};
