## What a strong solution looks like

A strong submission turns "we have backups" into numbers someone can defend. The stack comes up from a clean clone, archiving is verified by the tool rather than assumed, the incident and recovery are scripted so they can be rerun, and the restored data is checked against an independent ground truth (the write generator's log), not just eyeballed.

The restore goes into a **new** container. That is the realistic choice for logical corruption: production keeps serving, and you copy back what was lost. The README shows a results table with RPO and RTO per run, broken into phases, and explains what dominates each. The runbook is usable by someone who has never seen the repo: it names commands, expected outputs and decision points.

## Reference approach

### Postgres and pgBackRest configuration

```
# postgres/postgresql.conf (excerpt)
wal_level = replica
archive_mode = on
archive_command = 'pgbackrest --stanza=erp archive-push %p'
archive_timeout = 60
log_line_prefix = '%m [%p] %u@%d '
log_statement = 'ddl'          # so the DROP TABLE appears in the log with a timestamp
```

```ini
# pgbackrest/pgbackrest.conf
[global]
repo1-type=s3
repo1-s3-endpoint=minio:9000
repo1-s3-bucket=pg-backups
repo1-s3-region=us-east-1
repo1-s3-uri-style=path
repo1-s3-verify-tls=n          # local MinIO only
repo1-path=/erp
repo1-cipher-type=aes-256-cbc
repo1-retention-full=2
compress-type=zst
start-fast=y

[erp]
pg1-path=/var/lib/postgresql/data
```

S3 keys and `repo1-cipher-pass` come from environment variables (`PGBACKREST_REPO1_S3_KEY`, `PGBACKREST_REPO1_S3_KEY_SECRET`, `PGBACKREST_REPO1_CIPHER_PASS`) loaded from `.env`.

WAL-G is equally valid: `archive_command = 'wal-g wal-push %p'`, `wal-g backup-push $PGDATA`, then on restore `wal-g backup-fetch $PGDATA LATEST` with `restore_command = 'wal-g wal-fetch %f %p'` and `recovery_target_time`, plus `recovery.signal`.

### Drill script outline

```bash
#!/usr/bin/env bash
set -euo pipefail
docker compose up -d minio pg
./scripts/wait-for-pg.sh
docker compose exec pg pgbackrest --stanza=erp stanza-create
docker compose exec pg pgbackrest --stanza=erp check
docker compose exec pg pgbackrest --stanza=erp --type=full backup

npx tsx scripts/writer.ts > out/writes.jsonl &   # logs {maxId, committedAt} per batch
WRITER=$!
sleep 120
INCIDENT_AT=$(date -u +%FT%T.%3NZ)
docker compose exec pg psql -U postgres -d erp -c 'DROP TABLE stock_movements'
sleep 30; kill $WRITER
echo "$INCIDENT_AT" > out/incident.txt
```

Finding the target: the DDL log line gives the exact timestamp of the `DROP`. Target a moment slightly before it, and use `recovery_target_inclusive` deliberately. For a more precise target, `pg_waldump` on the archived segments can find the LSN of the drop's commit, and `--type=lsn` recovers exactly to it.

```bash
T0=$(date +%s)
docker compose run --rm pg-restore \
  pgbackrest --stanza=erp --type=time \
  --target="2026-11-11 15:00:41.200+00" --target-action=promote restore
docker compose up -d pg-restore
./scripts/wait-for-pg.sh pg-restore
npx tsx scripts/verify.ts      # compares restored rows to out/writes.jsonl
echo "RTO seconds: $(( $(date +%s) - T0 ))"
```

### Verification against ground truth

```ts
const lastLogged = lastBatchBefore(writesLog, incidentAt); // maxId committed before the drop
const { rows } = await restored.query(
  "SELECT max(id)::bigint AS max_id, count(*)::bigint AS n, max(created_at) AS last_at FROM stock_movements",
);
const rpoMs = lastLogged.committedAt.getTime() - rows[0].last_at.getTime();
assert(rows[0].n === rows[0].max_id, "gap in identity values before target");
assert(rpoMs <= 60_000, `RPO ${rpoMs}ms exceeds target`);
```

Note that identity values can have gaps from rolled-back transactions; if the generator never rolls back, contiguity is a valid check.

### Expected results

With `archive_timeout = 60`, archive-based RPO is at most about a minute when the WAL segment is not yet full, and typically much less under steady writes. When recovering on the same server where `pg_wal` still contains the unarchived tail, you can recover even closer to the drop; be clear in the README which case you measured. With a long `archive_timeout` on a quiet database, the RPO grows toward that value. RTO for a small database is dominated by container start and WAL replay; for 200 GB it is dominated by copying the backup, which is where parallel restore (`process-max`), delta restores, incremental backups, local backup copies and replicas delayed with `recovery_min_apply_delay` help.

## Common mistakes

- **Assuming archiving works** without running `check` or looking at `pg_stat_archiver`. A typo in `archive_command` means no WAL, and with archive failures WAL piles up in `pg_wal` until the disk fills.
- **Restoring over the original** and losing the good writes that happened after the incident on other tables.
- **No ground truth.** Without the generator log, "the data looks right" is the only verification.
- **Mixing local time and UTC** in the recovery target, which recovers to the wrong hour.
- **Measuring RTO from "start restore command"** instead of from "incident declared", ignoring the time to find the target and verify.
- **Unencrypted repository** and keys committed in config.
- **A runbook that says "restore the backup"** without commands, expected outputs or decision points.

## Trade-offs worth discussing

- **pgBackRest vs WAL-G**: both are mature. pgBackRest has strong verification, parallelism and a rich config model; WAL-G is a single binary with good cloud storage support and delta backups. Managed services make the choice for you.
- **Rewind production or restore aside**: rewinding is faster to "done" but discards valid later writes; restoring aside takes longer but loses nothing. The runbook should make this an explicit decision.
- **Delayed replica** (`recovery_min_apply_delay = '1h'`): a near-instant recovery source for logical mistakes, at the cost of another server.
- **Backup frequency vs RTO**: more frequent full or differential backups mean less WAL to replay at restore time.
- **Retention vs GDPR**: longer retention helps recovery but keeps deleted personal data longer.

## Grade yourself

| Dimension | Strong | Acceptable | Needs work |
|---|---|---|---|
| Reproducibility | One command runs the whole drill from a clean clone, twice, with different settings | Documented manual steps that work | Steps depend on state on your machine |
| Archiving correctness | `check` passes, encrypted repo, `archive_timeout` justified, archiver stats shown | Archiving works, defaults left unexamined | Base backup only, no WAL archive |
| Recovery | PITR into a new container, target found from logs or WAL, decision documented | PITR works but over the original | Restored only the base backup |
| Measurement | RPO and RTO computed against generator log, broken into phases, two runs compared | Single RPO/RTO numbers | No numbers or estimated by hand |
| Runbook | Commands, expected outputs, decision points, comms and verification steps | Ordered commands | Narrative without commands |

## Going further

- Add a scheduled GitHub Actions job that runs the restore drill weekly and fails on regressions in RTO.
- Add a delayed replica and compare recovery time for the same incident.
- Repeat with a 20 GB dataset and test `process-max` and delta restore effects on RTO.
