## What a strong solution looks like

The API becomes thin: validate, store the original under a deterministic key, insert an `images` row with status `queued`, enqueue a job carrying only `{ tenantId, imageId, originalKey }`, return `202` with a `Location` header. It never imports `sharp`, and a lint rule or a test enforces that. The worker is a separate entry point with its own npm script, concurrency set from measured CPU and memory, and a SIGTERM handler that calls `worker.close()`.

The handler is a plain function that can be tested without a queue. It is idempotent because every output is "make it so": deterministic variant keys that overwrite, and a status update that sets absolute values rather than incrementing anything. Invalid images throw `UnrecoverableError`; storage errors throw normal errors and are retried with backoff. A strong README shows the kill -9 test, the 30% storage failure test and a diagram whose numbered arrows match the code, and `npm test` proves idempotency and failure classification.

## Reference approach

### API: enqueue IDs, not bytes

```ts
app.post("/api/images", upload.single("file"), async (req, res) => {
  const { tenantId } = req.auth;
  if (!ALLOWED_TYPES.has(req.file.mimetype) || req.file.size > 20 * 1024 * 1024) {
    return res.status(415).json({ error: "unsupported file" });
  }
  const imageId = randomUUID();
  const originalKey = `tenants/${tenantId}/images/${imageId}/original`;
  await storage.put(originalKey, req.file.buffer);
  await db.images.insert({ id: imageId, tenantId, status: "queued", originalKey });
  await imageQueue.add("process", { tenantId, imageId, originalKey }, { jobId: imageId });
  res.status(202).location(`/api/images/${imageId}`).json({ imageId, statusUrl: `/api/images/${imageId}` });
});
```

`jobId: imageId` means a retried POST handler cannot enqueue the same image twice. The MIME check is only a first filter; the worker does the real validation by decoding the file.

For the strict p95 target, use `multer` with disk or stream storage (or presigned uploads as a stretch goal) so a 12 MB buffer is not held in memory per request.

### Worker handler: idempotent, classifies failures

```ts
export async function processImage(data: ImageJob, deps: HandlerDeps, onProgress = async (_: number) => {}) {
  const { storage, db, resize } = deps;
  await db.images.update(data.imageId, { status: "processing" });
  const original = await storage.get(data.originalKey);

  let meta;
  try {
    meta = await resize.probe(original); // sharp(original).metadata()
  } catch {
    await db.images.update(data.imageId, { status: "failed", error: "unsupported or corrupt image" });
    throw new UnrecoverableError("unsupported or corrupt image");
  }

  const variants = { thumb: 200, medium: 800, large: 1600 } as const;
  let done = 0;
  for (const [name, width] of Object.entries(variants)) {
    const out = await resize.toWebp(original, width);
    await storage.put(`tenants/${data.tenantId}/images/${data.imageId}/${name}.webp`, out); // overwrite on rerun
    await onProgress(Math.round((++done / 3) * 100));
  }
  await db.images.update(data.imageId, { status: "ready", error: null });
}
```

```ts
new Worker<ImageJob>("images", (job) => processImage(job.data, deps, (p) => job.updateProgress(p)), {
  connection,
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
});
```

Set `attempts: 4` (or more) and `backoff: { type: "exponential", delay: 2000 }` in `defaultJobOptions`, with `removeOnFail: false`. Mark the row `failed` for transient errors only in the worker's `failed` event when `job.attemptsMade >= job.opts.attempts`, otherwise a retrying job would flicker to `failed`.

### Concurrency

`sharp` uses libvips, which runs its work on a thread pool outside the JS thread, so one process can use several cores. A defensible setup on a 4-core, 8 GB box: concurrency 2 per process, 2 processes, giving 4 images in flight. Peak memory per job for a 12 MP photo is roughly 100–200 MB, which leaves headroom. Back it with Little's Law: at 30 uploads/s and about 3 s per image you need 90 in flight to keep up, so peaks queue up and drain afterwards. 40,000 images/day at 3 s is 120,000 CPU-seconds, about 1.4 cores averaged over a day, so 4 slots drain a burst of 200 images in about 200 x 3 / 4 = 150 s.

### Tests

```ts
it("is idempotent: two runs leave three variants and one ready row", async () => {
  const deps = makeDeps(); // in-memory storage map + test DB
  await processImage(job, deps);
  await processImage(job, deps);
  expect(deps.storage.keys(`tenants/t1/images/${job.imageId}/`)).toHaveLength(4); // original + 3
  expect(await deps.db.images.get(job.imageId)).toMatchObject({ status: "ready" });
});

it("fails permanently on a corrupt file", async () => {
  const deps = makeDeps({ original: Buffer.from("not an image") });
  await expect(processImage(job, deps)).rejects.toBeInstanceOf(UnrecoverableError);
});

it("retries transient storage errors", async () => {
  // run the real Worker against Redis with storage.put failing on the first call; assert attemptsMade === 2 and status ready
});
```

Add an HTTP test with `supertest` that tenant B's `GET /api/images/:id` returns 404, and that the enqueued payload's JSON is under 1 KB.

## Common mistakes

- **Random variant keys.** `randomUUID()` in the output path makes every retry create orphans. Deterministic keys are most of your idempotency.
- **Bytes in the job.** A 12 MB base64 payload in Redis per job exhausts memory during a 200-image import.
- **Retrying corrupt files.** Four attempts at decoding a text file wastes a minute and pollutes the failed set. Classify errors.
- **Status that lies.** Setting `failed` on the first transient error, or never setting it after the last attempt, so the UI either flickers or spins forever.
- **Concurrency picked at random.** `concurrency: 50` on a 2-core box makes every job slower and risks out-of-memory kills.
- **Graceful shutdown that exits immediately.** `process.exit()` without awaiting `worker.close()` loses the point of SIGTERM handling.
- **Ownership check missing on the status endpoint.** Image IDs leak in URLs; the endpoint must filter by tenant and return 404, not 403, to avoid confirming existence.

## Trade-offs worth discussing

- **Status in Postgres vs reading BullMQ state.** The DB row survives job removal and is easy to authorize; BullMQ state is richer but tied to retention settings. Most teams use the DB as the user-facing truth.
- **Polling vs SSE.** Polling every 2 s is trivial and fine at this scale; SSE needs sticky connections or pub/sub across instances.
- **Upload through the API vs presigned URLs.** Presigned uploads remove transfer cost from the API but need a "confirm upload" step and validation after the fact.
- **One queue vs priority lanes.** Bulk imports can starve a single user's upload; a separate queue or BullMQ priorities fixes it at the cost of more configuration.

## Grade yourself

| Dimension | Strong | Acceptable | Needs work |
| --- | --- | --- | --- |
| API isolation | No `sharp` import in API (enforced), p95 under 300 ms measured, health stays under 50 ms during load | Async works, timing measured once | API still processes or blocks on images |
| Idempotency | Deterministic keys, absolute status updates, run-twice test passes, kill -9 test documented | Deterministic keys, no test | Reruns create duplicates or orphans |
| Failure handling | Unrecoverable vs transient classified, backoff verified with 30% failure test, replay script | Retries configured, no classification | No retries or infinite retries |
| Tests | `npm test` covers idempotency, permanent failure, retries, tenant ownership, payload size | Handler unit tests only | No automated tests |
| Operations | Concurrency justified with numbers, graceful shutdown tested, failed jobs surfaced | Concurrency set, shutdown handler present | Defaults everywhere, failures invisible |
| Diagram | Numbered arrows match code, includes retry, DLQ and polling paths | Main path only | Missing or contradicts code |

## Going further

1. Add a priority lane so single uploads overtake a 200-image bulk import, and measure p95 time-to-ready for both.
2. Autoscale worker processes on queue depth and oldest job age, and show the drain time before and after.
3. Switch to presigned uploads and re-run the 100-parallel-upload test to see what the API p95 becomes.
