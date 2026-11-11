## What a strong solution looks like

A strong submission is small. The core change is about ten lines: build a `Map` from `productId` to count once, then loop over products once. What separates a senior answer from a quick one is everything around those ten lines: tests that prove the two versions agree on messy data, a benchmark that a skeptical reader would trust, and a README that connects the measured growth curve to the Big-O prediction.

The repo has separate modules for `matchNested`, `matchWithMap`, the orphan report and the multi-warehouse totals. `npm test` runs an equivalence suite on seeded data plus a few tiny hand-written fixtures where you can see the right answer by eye. `npm run bench` re-runs the equivalence check, then times each size with warm-up, reports median and p95, and prints a table that goes straight into the README. The write-up says plainly that the nested version is `O(n * m)` (about `O(n^2)` here), that the Map version is `O(n + m)` including the cost of building the Map, and shows the 5,000 to 10,000 step growing about 4x versus about 2x.

## Reference approach

### The Map version

```ts
export function matchWithMap(products: Product[], counts: InventoryCount[]): StockLine[] {
  const byProduct = new Map<string, InventoryCount>();
  for (const c of counts) {
    // Keep the FIRST count per product, to match matchNested's `break` semantics.
    if (!byProduct.has(c.productId)) byProduct.set(c.productId, c);
  }
  const out: StockLine[] = [];
  for (const p of products) {
    const onHand = byProduct.get(p.id)?.onHand ?? 0;
    out.push({ productId: p.id, sku: p.sku, onHand, valueCents: onHand * p.unitCostCents });
  }
  return out;
}
```

The `has` check is a detail most submissions miss. `matchNested` stops at the first matching count. A naive `map.set` keeps the last one. With single-warehouse data the two never differ, but the moment a duplicate count appears they silently disagree. Matching the baseline's semantics exactly is what "same output" means.

### Orphan report

```ts
export function orphanReport(products: Product[], counts: InventoryCount[]) {
  const productIds = new Set(products.map((p) => p.id));
  const countedIds = new Set(counts.map((c) => c.productId));
  return {
    unknownCounts: counts.filter((c) => !productIds.has(c.productId)),
    productsWithoutCount: products.filter((p) => !countedIds.has(p.id)),
  };
}
```

Two Sets, two filters: `O(n + m)` time and `O(n + m)` extra memory.

### Multi-warehouse totals

A summing `Map<string, number>` is the right default because the report only needs the total. Grouping into `Map<string, InventoryCount[]>` keeps data you never read and allocates an array per product. Group only if a later feature needs per-warehouse detail.

```ts
const totals = new Map<string, number>();
for (const c of counts) totals.set(c.productId, (totals.get(c.productId) ?? 0) + c.onHand);
```

### Tests

```ts
import { describe, it, expect } from "vitest";

describe("matchers agree", () => {
  for (const n of [1_000, 5_000, 10_000]) {
    it(`n = ${n}`, () => {
      const { products, counts } = generate(n);
      expect(matchWithMap(products, counts)).toEqual(matchNested(products, counts));
    });
  }
});

it("reports exact orphan totals for seeded data", () => {
  const { products, counts } = generate(1_000);
  const r = orphanReport(products, counts);
  expect(r.productsWithoutCount).toHaveLength(20);
  expect(r.unknownCounts).toHaveLength(10);
});

it("gives 0 on hand to a product with no count", () => {
  const products = [{ id: "P-1", sku: "A", name: "A", unitCostCents: 100 }];
  expect(matchWithMap(products, [])[0]).toMatchObject({ onHand: 0, valueCents: 0 });
});
```

### Expected numbers

On a typical recent laptop with Node 22, expect roughly 50 to 300 ms for the nested version at n = 10,000 (about 50 million comparisons, because each product scans on average half the counts and the 2% without a count scan all of them), and 0.3 to 1 ms for the Map version. A 100x to 500x speedup is normal. At 50,000 the nested version takes 1 to 3 seconds per run; the Map version stays in single-digit milliseconds.

The growth check is the real proof. Nested: 5,000 to 10,000 should be close to 4x. Map: close to 2x, but small timings are noisy, so 1.6x to 2.5x is fine if you explain it. If the Map version shows less than 2x, the 5,000 run probably was not fully warmed up or a GC pause landed in it.

## Common mistakes

- **Building the Map inside the product loop**, or calling `new Map(counts.map(...))` once per product. This is worse than the original.
- **Using `map.set` without the `has` check** and never noticing because the test data has no duplicates. Add a fixture with two counts for one product and decide on purpose.
- **Timing the generator.** Data generation is `O(n)` with allocation and can be larger than the Map match itself.
- **Reporting one run.** A single cold run of the Map version includes interpreter time before V8 optimizes it, and can look 5x slower than its steady state.
- **No sink.** If the result is never read, V8 may skip work. Store the result somewhere the benchmark reads.
- **Only testing equivalence on generated data.** Both versions can share the same bug (for example `valueCents` using the wrong field). Small hand-written fixtures with known answers catch that; equivalence tests cannot.
- **Biased shuffles.** `sort(() => Math.random() - 0.5)` is neither uniform nor guaranteed to be reproducible across engines. Fisher-Yates with a seeded generator is.

## Trade-offs worth discussing

- **Memory for time.** The Map costs `O(m)` extra memory. At 10,000 entries that is about a megabyte. At 10 million it would be over a gigabyte, and you would push the match into Postgres (`JOIN` or `COPY` into a temp table) instead.
- **Sort and merge.** Sorting both arrays and walking them with two pointers is `O(n log n)` time and needs no hash table. It is a reasonable choice when both inputs already arrive sorted (for example from `ORDER BY product_id`), which makes the merge pass `O(n + m)`.
- **Where the match belongs.** Since products come from Postgres, an interviewer may ask why not load the counts into a staging table and `JOIN`. That is often the right production answer: Postgres does exactly this as a Hash Join.
- **Readability.** The Map version should be as easy to read as the nested one. If it needs a comment to explain a trick, the trick is probably not worth it.

## Grade yourself

| Dimension | Strong | Acceptable | Needs work |
| --- | --- | --- | --- |
| Correctness | Map built once; first-count semantics match the baseline; duplicate-count fixture exists | Map built once, output equal on generated data | Output differs on some input, or Map rebuilt in a loop |
| Tests | `npm test` runs equivalence at 3 sizes, hand-written fixtures, exact orphan totals, multi-warehouse sum | Equivalence test only | Manual console check, or no tests |
| Benchmark method | Warm-up, 10+ timed runs, median and p95, generator outside timing, sink, same input for both | Warm-up and several runs, median only | Single `Date.now()` run |
| Growth evidence | README table for every n, 4x and 2x steps shown and anomalies explained | Table present, growth not discussed | One number per version |
| Orphans and extension | `O(n)` orphan report with Sets; summing Map with a written justification | Works but uses `filter` with `includes` somewhere | Missing or quadratic |
| Reproducibility | Seeded data, machine specs, Node version, exact commands | Seeded data, partial specs | Results cannot be reproduced |

## Going further

1. Implement the sort-and-merge version and add it to the table at n = 100,000. Measure peak `heapUsed` for all three.
2. Load the products from Postgres and the counts from a CSV, then compare the in-memory match against `COPY` into a temp table plus a `JOIN`. Report where the end-to-end time goes.
3. Run the nested version under `node --cpu-prof` and find the hot loop in the flame graph, so you recognize the shape next time you see it in production.
