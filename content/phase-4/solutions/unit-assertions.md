## What a strong solution looks like

A strong submission reads like a pricing specification that happens to be executable. `quote()` is a pure function: it parses `unknown`-ish input into a typed value at the top, then runs a short pipeline of integer steps (list, graduated volume discount, annual discount, coupon, cap, VAT), each producing whole cents. There is exactly one rounding helper, it is documented in the README and in a comment, and it is tested directly with half-cent cases.

The test file is the real deliverable. Its `describe` and `it` names spell out the rules ("seats 11-50 get 10% off only for the seats inside that bracket", "annual plus coupon never exceeds 40% of the post-volume subtotal"). Every expected number was worked out by hand or in a spreadsheet before the implementation existed, and the git history proves it: a red commit with tier-boundary tests, then a green commit. Validation failures are a custom error class with a `field` property, and every invalid-input test asserts both the class and the field. The suite runs in well under a second, coverage is 100% branches, and changing any constant by one unit breaks at least one named test.

## Reference approach

### Integer rounding without floats

Do the rounding in integers so no intermediate value is ever a float. With amounts in cents and rates in basis points, `amount * bp` stays a safe integer as long as you cap seats (the reference caps at 100,000 seats: `6000 * 100000 * 12 * 10000` is about `7.2e13`, far below `Number.MAX_SAFE_INTEGER` of about `9e15`). If you need unbounded inputs, switch to `BigInt`.

```ts
// src/billing/money.ts
// Round half to even, applied to amountCents * bp / 10_000, integers only.
export function applyBp(amountCents: number, bp: number): number {
  const numerator = amountCents * bp;
  const q = Math.floor(numerator / 10_000);
  const r = numerator - q * 10_000;
  if (r * 2 > 10_000) return q + 1;
  if (r * 2 < 10_000) return q;
  return q % 2 === 0 ? q : q + 1;
}
```

Half-up is equally acceptable if documented; what matters is one rule, used everywhere, with a test that distinguishes it from the alternative (4.5 cents must become 4 under half-even and 5 under half-up).

### Graduated tiers as data

```ts
const BRACKETS = [
  { from: 1, to: 10, bp: 0 },
  { from: 11, to: 50, bp: 1_000 },
  { from: 51, to: Infinity, bp: 2_000 },
] as const;

function volume(seats: number, unitCents: number, months: number) {
  let listCents = 0;
  let discountCents = 0;
  for (const b of BRACKETS) {
    const inBracket = Math.max(0, Math.min(seats, b.to) - b.from + 1);
    const line = inBracket * unitCents * months;
    listCents += line;
    discountCents += applyBp(line, b.bp);
  }
  return { listCents, discountCents };
}
```

Representing brackets as a table makes the 50-seats-at-10% bug from the brief structurally hard to reintroduce, and the boundary tests (10, 11, 50, 51) pin it.

### Discount order and the cap

The brief says the coupon applies to what remains after the annual discount, and the combined discount is capped at 40% of the post-volume subtotal:

```ts
const sub = listCents - volumeDiscountCents;
const annual = cycle === "annual" ? applyBp(sub, 1_500) : 0;
const coupon = applyBp(sub - annual, couponBp);
const cap = applyBp(sub, 4_000);
const cycleAndCouponDiscountCents = Math.min(annual + coupon, cap);
const netCents = sub - cycleAndCouponDiscountCents;
```

### Hand-calculated expectations

These are the kind of rows the valid and rounding tables should contain (half-even):

| Case | Post-volume subtotal | Annual + coupon | Net | VAT | Total |
|---|---|---|---|---|---|
| Growth, 12 seats, monthly, DE | 35,400 | 0 | 35,400 | 6,726 | 42,126 |
| Growth, 12 seats, annual, DE, coupon 2,000 bp | 424,800 | 63,720 + 72,216 = 135,936 | 288,864 | 54,884 (from 54,884.16) | 343,748 |
| Same, coupon 5,000 bp (cap) | 424,800 | capped at 169,920 | 254,880 | 48,427 (from 48,427.2) | 303,307 |
| Starter, 1 seat, monthly, NL, coupon 30 bp | 1,500 | 4 (from 4.5, half-even) | 1,496 | 314 (from 314.16) | 1,810 |

### Validation as a parser

```ts
export class InvalidQuoteInputError extends Error {
  constructor(public readonly field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = "InvalidQuoteInputError";
  }
}

function parseSeats(v: unknown): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1 || v > 100_000) {
    throw new InvalidQuoteInputError("seats", `must be an integer 1-100000, got ${String(v)}`);
  }
  return v;
}
```

Test it through `quote()` with tables:

```ts
it.each([0, -5, 2.5, NaN, Infinity, 1e12, "12"])("rejects seats=%s", (seats) => {
  expect(() => quote({ ...valid, seats } as never)).toThrow(
    expect.objectContaining({ name: "InvalidQuoteInputError", field: "seats" }),
  );
});
```

Reverse charge: the reference requires the VAT ID prefix to match `country`, the country to be an EU country other than DE, and the format to pass a per-country regex. A DE customer supplying a DE VAT ID is a domestic sale: VAT is still charged, and a test titled "a domestic VAT ID cannot be used to avoid German VAT" asserts 19% is applied. A malformed or country-mismatched ID throws with `field: "vatId"`.

## Common mistakes

- **Copying expected values from the implementation's output.** The test then asserts that the code does what the code does. If the 51+ tier is wrong, the test is wrong in the same way.
- **Applying the tier rate to all seats** (flat volume pricing). Exactly the incident in the brief; the 12-seat worked example catches it.
- **Using floats with a final `Math.round`.** It often passes the obvious cases and drifts by a cent on others, especially VAT on large annual totals.
- **Applying the coupon to the post-volume subtotal instead of the post-annual amount**, or applying the cap to the coupon alone. Both are easy to miss without a test at and just past the cap.
- **Bare `toThrow()` or `toThrow(Error)`.** A `TypeError` from a missing property passes it. Assert the class name and field.
- **No red commit.** Writing tests after the implementation and squashing history removes the evidence that the tests can fail.
- **Over-mocking.** Stubbing the rounding helper or VAT table inside `quote()` tests means the real composition is never exercised.

## Trade-offs worth discussing

- **Round per line versus round once at the end.** Per-line rounding matches what appears on an invoice (each line is a whole number of cents and the lines sum to the total). Rounding once at the end is more precise but produces line items that do not add up. Finance usually wants the former; document it.
- **Half-even versus half-up.** Half-even removes systematic upward bias across many lines; half-up is what most people expect and what many tax authorities specify. Know which your jurisdiction requires.
- **`number` versus `BigInt` or a decimal library.** Bounded integers in `number` are fast and simple; `BigInt` removes the bound but complicates JSON and arithmetic. Bounding seats is a product decision as much as a technical one.
- **Validation in `quote()` versus at the HTTP edge.** A schema at the edge (zod) is idiomatic, but keeping a parser in the pure function makes it safe for every caller, including CSV imports and admin scripts.
- **Example tables versus property-based tests.** Tables document specific rules; properties (total = net + VAT, discount never exceeds the cap) catch combinations nobody thought to list. Strong suites use both.

## Grade yourself

| Dimension | Strong | Acceptable | Needs work |
|---|---|---|---|
| Money representation | Integers end to end, one rounding helper with its own half-cent tests, seat bound keeps products safe | Integers, rounding documented but tested only indirectly | Any float in money paths, or `toBeCloseTo` on cents |
| Boundary coverage | 10, 11, 50, 51 seats, cap exactly hit and exceeded, each country plus reverse charge, all with hand-derived cents | Boundaries covered, some expected values copied from output | Only happy-path cases or a single tier tested |
| Invalid input | Every bad value in the brief is a table row asserting class and `field`; JSON-parsed unknown plan and country included | Most invalid cases covered with specific error class | Bare `toThrow()`, or invalid input silently produces a quote |
| Test readability | Test names alone reconstruct the pricing rules; three clear `describe` blocks; `it.each` for repetition | Organised, but names describe code rather than rules | One long test or names like "works" |
| TDD evidence | Red commit with failing boundary tests followed by green commit; small focused commits | Tests and code committed together but clearly test-first | No tests in history until the end |
| Mutation resistance | Each of the four hand mutations in the brief fails a named test; Stryker score reported | Three of four hand mutations caught | Changing the cap or a rate breaks nothing |

## Going further

- Add fast-check properties: for any valid input, `totalCents === netCents + vatCents`, `cycleAndCouponDiscountCents <= applyBp(sub, 4000)`, and the total is monotonic in seats for a fixed plan.
- Run Stryker on `quote.ts`, read the surviving mutants, and either add the missing test or delete the dead code they reveal.
- Export your hand-calculated table to a JSON "golden file" that finance could review, and drive the valid-calculation tests from it.
