## Scenario

Your ERP's database has "backups", but nobody on the team has ever restored one. The CTO asks two questions in a planning meeting: "If someone drops the `stock_movements` table at 15:00, how much data do we lose, and how long are we down?" Nobody can answer with a number.

You will answer with evidence. Build a local, reproducible backup setup with continuous WAL archiving, simulate a destructive mistake under write load, recover to the moment before it, and measure the real RPO and RTO. Then write the runbook the on-call engineer would follow.

## Starting point

- Docker and Docker Compose.
- Postgres 16 or 17 (official image, or one with your backup tool installed).
- An S3-compatible bucket in MinIO as the backup repository.
- Your choice of **pgBackRest** or **WAL-G**.

A minimal schema for the write generator:

```sql
CREATE TABLE stock_movements (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku        text NOT NULL,
  qty_delta  integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
```

## What to build

1. **Stack.** A `compose.yaml` with Postgres, MinIO (with the bucket created on startup), and the backup tool configured. Archiving must be enabled (`archive_mode`, `archive_command`, a sensible `archive_timeout`) and verified with the tool's check command.
2. **Base backup.** A script that takes a full backup into MinIO and prints backup info.
3. **Write generator.** A small TypeScript script that inserts movements continuously (for example 50 per second) and logs the id and commit time of each batch to a local file, so you know the ground truth of what was committed when.
4. **The incident.** While the generator runs, a script records the timestamp and runs `DROP TABLE stock_movements;` (or a `DELETE` without a `WHERE`). Writes continue to fail or to other tables afterwards.
5. **Recovery.** Perform point-in-time recovery into a **new** Postgres container (not over the original), targeting just before the drop. Verify the restored data against the generator's log.
6. **Measurement.** Compute:
   - **RPO**: the time between the last committed row before the incident (from the generator log) and the last row present after restore.
   - **RTO**: wall-clock time from "incident declared" to "restored database accepts queries and passes verification".
7. **RUNBOOK.md.** A step-by-step procedure for this scenario, written for someone who has not seen your repo, including how to find the recovery target time.

## Constraints

- Everything must run from a clean clone with documented commands (`make drill` or a set of npm scripts is ideal).
- No manual edits inside containers; configuration lives in files in the repo.
- Backup repository credentials come from an env file that is not committed (provide `.env.example`).
- The backup repository must be encrypted (pgBackRest cipher or WAL-G libsodium/OpenPGP).
- The drill must run at least twice: once with `archive_timeout = 60` and once with a much longer value or archiving lag, so you can show how configuration changes RPO.

## How to measure and verify

Automate the verification as a script or test that exits non-zero on failure:

- The restored table's max `id` and row count match the generator's log up to the recovery target, with no rows committed after the drop and no gap in ids before it (allowing for the documented RPO).
- The restored database passes `SELECT count(*)` on every table and `pg_amcheck` (or an equivalent full read) without errors.
- The backup tool's `info` output shows the full backup and a continuous WAL range covering the incident.

Record in the README a results table: run, `archive_timeout`, database size, number of WAL segments replayed, measured RPO, measured RTO broken down into phases (provision, restore files, WAL replay, verification). Then answer in one paragraph: what would you change to halve RTO for a 200 GB database?
