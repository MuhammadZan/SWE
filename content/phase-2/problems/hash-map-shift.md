## Scenario

Your ERP runs a nightly job that produces a "Stock Position" report: every product in the catalog, matched to its current inventory count from the warehouse system. The two datasets come from different sources (the catalog from your Postgres `products` table, the counts from a warehouse management system export), so the job matches them in application code.

The original implementation was written when the catalog had 400 products. Today it has 10,000 products and 10,000 inventory records, and the job takes long enough that it occasionally overlaps with the morning shift's first imports. Your job is to prove why, fix it, and document the improvement with real numbers.

## Starting point

Create a small TypeScript project (Node 20+, `tsx` or `ts-node` to run). Use a seeded random generator so every run produces identical data:

```ts
// data.ts
export type Product = { id: string; sku: string; name: string; unitCostCents: number };
export type InventoryCount = { productId: string; warehouseId: string; onHand: number };

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generate(n: number, seed = 42) {
  const rand = mulberry32(seed);
  const products: Product[] = Array.from({ length: n }, (_, i) => ({
    id: `P-${String(i).padStart(6, "0")}`,
    sku: `SKU-${Math.floor(rand() * 1e9).toString(36).toUpperCase()}`,
    name: `Product ${i}`,
    unitCostCents: 100 + Math.floor(rand() * 50_000),
  }));
  const counts: InventoryCount[] = products.map((p) => ({
    productId: p.id, warehouseId: "WH-1", onHand: Math.floor(rand() * 500),
  }));
  // Fisher-Yates shuffle so the counts are not in the same order as products.
  // (Do not use sort(() => rand() - 0.5): it is biased and its output depends on the engine's sort.)
  for (let i = counts.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [counts[i], counts[j]] = [counts[j], counts[i]];
  }
  // Simulate real-world mess: 2% of products have no count, 1% of counts reference unknown products
  counts.splice(0, Math.floor(n * 0.02));
  for (let i = 0; i < n * 0.01; i++) counts.push({ productId: `P-X${i}`, warehouseId: "WH-1", onHand: 1 });
  return { products, counts };
}
```

The baseline implementation you must start from:

```ts
export type StockLine = { productId: string; sku: string; onHand: number; valueCents: number };

export function matchNested(products: Product[], counts: InventoryCount[]): StockLine[] {
  const out: StockLine[] = [];
  for (const p of products) {
    let onHand = 0;
    for (const c of counts) {
      if (c.productId === p.id) { onHand = c.onHand; break; }
    }
    out.push({ productId: p.id, sku: p.sku, onHand, valueCents: onHand * p.unitCostCents });
  }
  return out;
}
```

## What to build

1. **`matchNested`** exactly as above (your baseline).
2. **`matchWithMap`**: pre-index the inventory counts into a `Map<string, InventoryCount>` keyed by `productId`, then make a single pass over products. Same output, same order.
3. **An orphan report**: list inventory counts whose `productId` does not exist in the catalog, and products with no count. This must also be `O(n)`.
4. **Automated tests** (`npm test`, with Vitest or `node:test`):
   - an equivalence test asserting both implementations produce deeply equal output for seeded data at n = 1,000, 5,000, and 10,000;
   - small hand-written fixtures (three or four products) covering a product with no count (`onHand` 0), an orphan count, and the order of output lines;
   - orphan report totals for a seeded n = 1,000 dataset (exactly 20 products without counts and 10 orphan counts);
   - a multi-warehouse test where one product has 3 counts and its total is their sum.
   The benchmark script should also re-run the equivalence check before timing.
5. **A benchmark script** (`npm run bench`) that runs both implementations at n = 1,000, 5,000, 10,000, and 50,000 (skip nested at 50,000 if it exceeds 60 seconds, and say so), with warm-up runs and multiple timed runs, printing median and p95.
6. **A multi-warehouse extension**: change the generator so each product has counts in 1 to 3 warehouses, and produce total on-hand per product. Decide between a `Map<string, number>` that sums and a `Map<string, InventoryCount[]>` that groups, and justify it in the README.

## Constraints

- Write all core logic by hand. No lodash `keyBy`/`groupBy` and no AI-generated implementations.
- Do not sort either array as part of your solution (that is a valid alternative approach, but this exercise is about hash maps; mention it as a comparison in the README if you like).
- Data generation must happen outside the timed section.
- Both implementations must handle the messy data (missing counts, orphans) identically.

## How to measure and verify

- Use `performance.now()` with at least 5 warm-up runs and at least 10 timed runs per size for the Map version, and at least 3 timed runs for the nested version at 10,000.
- Record a table in the README:

| n | nested median | nested p95 | map median | map p95 | speedup |
|---|---|---|---|---|---|

- Verify the growth curve. When n goes from 5,000 to 10,000, the nested version should take roughly 4x longer and the Map version roughly 2x. If your numbers do not show this, explain why (warm-up, GC, cache effects).
- Run the correctness check on every size before timing. A fast wrong answer is a failed exercise.
- Note your machine, Node version, and whether anything else was running.
