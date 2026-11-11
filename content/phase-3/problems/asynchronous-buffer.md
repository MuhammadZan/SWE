## Scenario

Your SaaS lets users upload product photos for their catalog and receipt images for expense claims. Right now the upload endpoint receives the file, resizes it into three variants (thumbnail 200px, medium 800px, large 1600px), compresses them to WebP, uploads them and only then responds. A 12 MB phone photo takes 3–6 seconds. During bulk catalog imports, users upload 200 images at once, the API instances pin at 100% CPU, and unrelated requests like login and invoice saving start timing out.

You will move image processing out of the request lifecycle. The endpoint stores the original, enqueues a job, and returns `202 Accepted` immediately. A separate worker process does the CPU-heavy work.

## Scale numbers

- 15,000 daily active users; about 40,000 image uploads/day.
- Bulk imports create bursts of 50–200 images per user within a minute; month-start catalog refreshes produce peaks around 30 uploads/second across all tenants.
- Processing time per image: 1.5–5 seconds of CPU.
- Targets: upload endpoint p95 under 300 ms (excluding network transfer of the file itself); every accepted image eventually processed or visibly failed; no duplicate variants.

## Starting point

- Node/TypeScript API (Express, Fastify or Next.js route handlers).
- Redis plus BullMQ for the queue. Using an in-memory queue is acceptable for a first pass, but the final version must survive a worker restart, which in-memory cannot.
- `sharp` for image processing.
- Local disk folders or a local S3-compatible store (MinIO) standing in for object storage.

## What to build

1. `POST /api/images`: validates type and size, stores the original under a deterministic key, creates an `images` record with status `queued`, enqueues a job containing only IDs and storage keys (never the file bytes), and returns `202` with `{ imageId, statusUrl }` and a `Location` header.
2. `GET /api/images/:id`: returns status (`queued`, `processing`, `ready`, `failed`), progress, and variant URLs when ready. Enforce ownership: a user cannot read another tenant's image status.
3. A worker running as a **separate process** that generates the three variants, writes them to storage under deterministic keys, updates the record to `ready`, and reports progress.
4. Retry policy: at least 4 attempts with exponential backoff. Corrupt or unsupported files must fail permanently without retries.
5. A failed-jobs view or script that lists jobs which exhausted retries (your dead-letter queue) with their error, and a way to replay one.
6. Graceful shutdown: the worker finishes in-flight jobs on SIGTERM.

## What to draw

Draw the full asynchronous flow on the whiteboard and include the exported diagram in your repo. It must show the client, API, object storage for originals and variants, the queue, the worker pool, the database status record, retries and the dead-letter path, and how the client learns the job is done (polling arrow back to the status endpoint). Number the arrows in order of a single upload's journey.

## Constraints

- The API process must never call `sharp`.
- Job handlers must be idempotent: running the same job twice produces the same three files and one consistent DB state.
- Job payloads under 1 KB.
- Configure worker concurrency explicitly and justify the number in your README (cores, memory per job).

## How to verify

- Upload 100 images in parallel with a script. Every response returns 202 and the measured p95 is under 300 ms.
- Meanwhile, a separate loop hitting `GET /api/health` keeps responding in under 50 ms, proving the API is no longer CPU-starved.
- All 100 images eventually reach `ready`; report total drain time.
- `kill -9` the worker mid-batch, restart it, and confirm every image still reaches `ready` with exactly three variants (no duplicates, no orphans).
- Upload a text file renamed to `.jpg`: it reaches `failed` after one attempt, not after four.
- Make storage writes fail randomly 30% of the time: jobs retry with growing delays and eventually succeed.
