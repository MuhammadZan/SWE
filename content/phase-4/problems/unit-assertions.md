## Scenario

You maintain the billing module of a B2B SaaS product. Pricing works like this:

- Plans are charged **per seat per month**: Starter 1,500 cents, Growth 3,000 cents, Enterprise 6,000 cents.
- **Volume discount** on seats in tiers, applied *graduated* (like tax brackets, not a flat rate on all seats):
  - seats 1-10: 0% off
  - seats 11-50: 10% off
  - seats 51+: 20% off
- **Annual billing** gives an extra 15% off the post-volume subtotal, and the period is 12 months.
- An optional **coupon** in basis points (0-10,000) applies last. The total discount from annual + coupon combined may never exceed 40% of the post-volume subtotal.
- **VAT** is added on the discounted net amount, by billing country: DE 19%, FR 20%, NL 21%, US 0% (handled elsewhere). Reverse charge: if the customer has a valid EU VAT ID and the country is not the seller's country (DE), VAT is 0.

Last quarter a refactor introduced a bug where 50 seats were billed entirely at the 10% tier rate. Nobody noticed for six weeks. Your job is to make that impossible to ship again.

## Starting point

```ts
// src/billing/quote.ts
export type Plan = "starter" | "growth" | "enterprise";
export type Cycle = "monthly" | "annual";
export type Country = "DE" | "FR" | "NL" | "US";

export interface QuoteInput {
  plan: Plan;
  seats: number;
  cycle: Cycle;
  country: Country;
  couponBp?: number;
  vatId?: string; // e.g. "FR12345678901"
}

export interface Quote {
  listCents: number;        // before any discount, for the whole period
  volumeDiscountCents: number;
  cycleAndCouponDiscountCents: number;
  netCents: number;
  vatCents: number;
  totalCents: number;
}

export function quote(input: QuoteInput): Quote {
  throw new Error("not implemented");
}
```

You may change the internal structure (split into helpers, add a `money.ts`) but keep `quote()` as the public API.

## What to build

1. An implementation of `quote()` using **integer cents only**, rounding with a single documented rule (round half to even or half up; pick one, document it, test it).
2. A Vitest suite organised into three `describe` blocks:
   - **Valid calculations**: at least one test per plan, graduated tier boundaries (10, 11, 50, 51 seats), annual vs monthly, coupon stacking hitting the 40% cap, each VAT country, and reverse charge.
   - **Rounding**: cases where a fraction of a cent occurs, asserting the exact expected cent.
   - **Bad or malicious input**: seats of 0, -5, 2.5, `NaN`, `Infinity`, `1e12`; a coupon of -1, 10,001, or a string; an unknown plan or country arriving via `JSON.parse` from an HTTP body; a `vatId` that is malformed or belongs to the seller's own country.
3. Custom error classes (for example `InvalidQuoteInputError` with a `field` property) so callers and tests can tell validation failures apart from bugs.

The outline asks for at least three tests. Treat three as the minimum count of *describe blocks*; a serious money function needs 25 or more cases, most of them table-driven with `it.each`.

## Constraints

- No floating-point money. Intermediate percentages must be in basis points or another integer form.
- No mocking inside `quote()`; it is pure. If you decide VAT rates come from a provider, inject it as a parameter and use a stub.
- Every validation test asserts the **specific** error class and field, never a bare `toThrow()`.
- Write the tier-boundary tests **before** the graduated-tier implementation (TDD). Commit the red state, then the green state, so the history shows it.
- Tests run in under one second total.

## Worked expectation (check your understanding)

Growth, 12 seats, monthly, DE, no coupon:

```
seats 1-10: 10 x 3000           = 30,000
seats 11-12: 2 x 3000 x 0.90    =  5,400
volume subtotal                  = 35,400   (list 36,000, volume discount 600)
net                              = 35,400
VAT 19%                          =  6,726
total                            = 42,126
```

If your implementation disagrees, check whether you applied the tier rate to all seats.

## How to verify

- `npx vitest run` passes; `npx vitest run --coverage` shows 100% branch coverage of `quote.ts`.
- Mutation check by hand: change the 51+ tier to 15%, change `>` to `>=` at a boundary, remove the 40% cap, swap FR and NL rates. Each change must fail at least one test with a name that explains the rule. Revert after each.
- Run `npx tsc --noEmit` with `strict: true`.
- Ask someone (or yourself a day later) to read only the test names. They should be able to reconstruct the pricing rules from them.
