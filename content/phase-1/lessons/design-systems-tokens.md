## Why this matters

Open any SaaS codebase that's three years old and search for `#3b82f6`. You'll find it 140 times, along with `#3B82F6`, `#3b83f6` (a typo nobody caught), `rgb(59,130,246)`, and `bg-blue-500`. Then marketing changes the brand color. Or a large customer requires dark mode. Or an accessibility audit says your warning text fails contrast. Each of those becomes a week-long find-and-replace with visual regressions on every screen.

The same thing happens with spacing (`padding: 12px` here, `14px` there, `p-3.5` somewhere else), border radii, font sizes and shadows. The UI drifts. Each screen looks slightly different, and every new component reinvents decisions that were already made.

A **design system** fixes this the same way backend architecture does. It **centralizes decisions and makes everything else depend on them.** Design tokens are the domain layer of your UI.

## What a design system actually is

A design system is three things that reinforce each other:

1. **Design tokens:** named, centralized values for every visual decision (color, spacing, type, radius, shadow, motion, z-index).
2. **A component library:** strictly typed components (`Button`, `Card`, `Alert`, `Modal`) that consume tokens only and expose a small, constrained API.
3. **Usage rules and documentation:** when to use `Alert` versus `Toast`, which button variant is the primary action, and so on, usually shown in Storybook.

Without tokens, components hardcode values. Without components, every screen hand-rolls markup. Without docs, people don't know which component to use and build a new one.

## Design tokens in depth

A token is a name for a decision. `color.danger` is a decision. `#dc2626` is a value that implements it today.

### The three tiers

Mature systems layer tokens so that each tier has one reason to change:

```
  Primitive (raw palette)      Semantic (meaning)           Component (specific use)
  ---------------------        ------------------           ------------------------
  red-800   = #991b1b   --->   color.danger.fg     --->     alert.danger.text
  red-600   = #dc2626   --->   color.danger.border --->     alert.danger.border
  red-50    = #fef2f2   --->   color.danger.bg     --->     alert.danger.background
  space-4   = 16px      --->   space.inset.md      --->     card.padding
  radius-2  = 8px       --->   radius.surface      --->     modal.radius
```

- **Primitive tokens** define the full palette and scales. They have no meaning, only values. Components should never reference them directly.
- **Semantic tokens** carry intent: `color.text.muted`, `color.surface.raised`, `color.border.danger`, `space.stack.sm`. Theming happens here. Dark mode remaps semantic tokens to different primitives.
- **Component tokens** (optional) cover per-component overrides such as `button.primary.bg`. They're useful in large systems, and too much for small ones.

The Dependency Rule appears again here: components depend on semantic tokens, semantic tokens depend on primitives, and nothing depends on components.

### Scales instead of arbitrary numbers

Spacing and typography should come from a **scale**, not from whatever looks right on someone's monitor:

```ts
// tokens/primitives.ts
export const space = {
  0: "0px", 1: "4px", 2: "8px", 3: "12px", 4: "16px",
  5: "24px", 6: "32px", 7: "48px", 8: "64px",
} as const;

export const fontSize = {
  xs: "0.75rem", sm: "0.875rem", md: "1rem", lg: "1.125rem", xl: "1.25rem", "2xl": "1.5rem",
} as const;
```

A 4px/8px base grid means every gap in the app is a multiple of 4. A designer can look at a screen and tell immediately when a value doesn't fit.

## Implementing tokens in TypeScript and CSS

The most robust approach for React apps is **TypeScript as the source of truth and CSS custom properties at runtime**. CSS variables let you theme without re-rendering React. TypeScript gives you autocompletion and compile errors.

### Bad: hardcoded everywhere

```tsx
export function InvoiceOverdueBanner({ days }: { days: number }) {
  return (
    <div style={{ background: "#fef2f2", border: "1px solid #dc2626", padding: 14, borderRadius: 6 }}>
      <strong style={{ color: "#991b1b", fontSize: 15 }}>Overdue by {days} days</strong>
    </div>
  );
}
```

Five magic values, one of which (`14`) isn't on any scale. There's no dark mode, and this banner will look subtly different from the "subscription expiring" banner someone else writes next month.

### Better: a token module

```ts
// tokens/semantic.ts
export const semantic = {
  color: {
    surface: { default: "var(--color-surface-default)", raised: "var(--color-surface-raised)" },
    text: { default: "var(--color-text-default)", muted: "var(--color-text-muted)" },
    danger: { fg: "var(--color-danger-fg)", bg: "var(--color-danger-bg)", border: "var(--color-danger-border)" },
    warning: { fg: "var(--color-warning-fg)", bg: "var(--color-warning-bg)", border: "var(--color-warning-border)" },
    success: { fg: "var(--color-success-fg)", bg: "var(--color-success-bg)", border: "var(--color-success-border)" },
    info: { fg: "var(--color-info-fg)", bg: "var(--color-info-bg)", border: "var(--color-info-border)" },
  },
  space: { inset: { sm: "var(--space-2)", md: "var(--space-4)", lg: "var(--space-5)" } },
  radius: { control: "var(--radius-1)", surface: "var(--radius-2)" },
} as const;
```

```css
/* tokens/theme.css, generated from primitives (by hand or with Style Dictionary) */
:root {
  --space-2: 8px; --space-4: 16px; --space-5: 24px;
  --radius-1: 4px; --radius-2: 8px;
  --color-surface-default: #ffffff;
  --color-text-default: #0f172a;
  --color-danger-fg: #991b1b; --color-danger-bg: #fef2f2; --color-danger-border: #dc2626;
}
[data-theme="dark"] {
  --color-surface-default: #0b1220;
  --color-text-default: #e2e8f0;
  --color-danger-fg: #fecaca; --color-danger-bg: #450a0a; --color-danger-border: #f87171;
}
```

Dark mode is now a matter of setting a `data-theme` attribute, with no component changes.

### Best: a typed component that limits choices

```tsx
// components/alert.tsx
import { semantic as t } from "@/tokens/semantic";

type Tone = "info" | "success" | "warning" | "danger";

type AlertProps = {
  tone: Tone;
  title: string;
  children?: React.ReactNode;
};

export function Alert({ tone, title, children }: AlertProps) {
  const c = t.color[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      style={{
        background: c.bg,
        border: `1px solid ${c.border}`,
        color: c.fg,
        padding: t.space.inset.md,
        borderRadius: t.radius.surface,
      }}
    >
      <strong>{title}</strong>
      {children}
    </div>
  );
}

// usage
<Alert tone="danger" title={`Invoice overdue by ${days} days`} />
```

Two things are intentional here:

- **There is no `color` or `style` prop.** A component that accepts any color will be used with every color. Constraints are the point. If someone needs a new tone, they add it to the union type and the token file, and it shows up in code review.
- **`Tone` is a union, not a `string`.** `tone="eror"` fails at compile time.

### With Tailwind

If you use Tailwind, tokens go in the theme config (or the `@theme` block in Tailwind v4) as CSS variables. Then you ban arbitrary values such as `p-[13px]` and `bg-[#3b82f6]` in components with a lint rule. Tailwind's default palette is a set of *primitives*. Define semantic names (`bg-danger-subtle`, `text-muted`) on top of it, or you'll have `bg-red-50` in 80 files with nothing to say it means "danger".

## Variants and typed component APIs

Libraries like `class-variance-authority` (cva) formalize the variant pattern:

```ts
const button = cva("inline-flex items-center rounded-control font-medium", {
  variants: {
    intent: { primary: "bg-accent text-on-accent", secondary: "bg-surface-raised text-default", danger: "bg-danger text-on-danger" },
    size: { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-md" },
  },
  defaultVariants: { intent: "primary", size: "md" },
});
type ButtonProps = VariantProps<typeof button> & React.ButtonHTMLAttributes<HTMLButtonElement>;
```

The type system now documents every legal button in the product. This is the frontend version of an interface boundary.

## Composition over configuration

A `Card` with 25 boolean props (`hasHeader`, `hasFooter`, `compact`, `noBorder`, `headerRight`, and so on) is a design system smell. Use composition instead:

```tsx
<Card>
  <Card.Header title="Inventory value" action={<Button size="sm">Export</Button>} />
  <Card.Body>{/* ... */}</Card.Body>
  <Card.Footer>Updated 3 min ago</Card.Footer>
</Card>
```

Each sub-component reads its padding and borders from tokens, so a Card is consistent no matter who assembles it.

## Accessibility belongs to the design system

Centralizing components also centralizes accessibility. Fix it once and it's fixed everywhere:

- `Modal`: focus trap, `aria-modal`, `role="dialog"`, labelled by its title, Escape closes it, focus returns to the trigger. The native `<dialog>` element opened with `showModal()` (which makes the rest of the page inert) or Radix UI handle most of this, but test focus return yourself.
- `Alert`: `role="alert"` for urgent messages and `role="status"` for polite ones.
- Color tokens: semantic pairs (`danger.fg` on `danger.bg`) should be checked against WCAG AA (4.5:1 for body text) *once, in the token file*, not on every screen.

## Common mistakes

- **Semantic names that are really primitives.** `color.blue` isn't semantic. `color.accent` is. When the brand becomes green, `color.blue = green` is a lie that everyone has to remember.
- **Escape hatches everywhere.** Allowing `style`, `className` and `color` overrides on every component means the design system is optional, so it will be ignored. Provide narrow, typed extension points.
- **Tokens only in Figma, or only in code.** If designers and developers keep separate token lists, they drift. Keep one source (a JSON or TS file) and generate the others. Tools like Style Dictionary and Tokens Studio exist for this.
- **Theming with JS re-renders.** Switching themes through React context and inline JS colors forces a full re-render and flashes on load. CSS variables switch instantly and work with SSR.
- **Building the whole library up front.** Start with the five components you use most (Button, Input, Card, Alert, Modal). Extract the rest when a pattern shows up for the third time.

## In the real world

- **Public design systems are worth studying:** Shopify Polaris, GitHub Primer, IBM Carbon, Atlassian Design System and Radix Themes. All of them publish their token architecture.
- **shadcn/ui**, which is very common in Next.js SaaS apps, is essentially a token-driven component pattern. Components read CSS variables like `--primary` and `--muted-foreground` that you define once.
- **ERP UIs** gain a lot from design systems because they're dense, with hundreds of forms, tables and status badges. A `StatusBadge` component typed as `status: InvoiceStatus` that maps to tones keeps "overdue" red on every screen.
- **Interviews** for frontend or full-stack roles often ask "How would you implement dark mode across a large app?" or "How do you keep UI consistent across teams?" Answer with tiered tokens, CSS variables, constrained component APIs, lint rules and visual regression tests (Chromatic or Playwright screenshots).

## Try it

1. Grep one of your projects for hex colors and pixel values inside components: `grep -rE "#[0-9a-fA-F]{3,6}|[0-9]+px" src/components | wc -l`. Write down the number.
2. Create `tokens/primitives.ts` and `tokens/semantic.ts` with a color palette, a 4px spacing scale and two radii.
3. Refactor one component (a status badge or alert) to read only from semantic tokens, with a union-typed `tone` prop.
4. Add a `[data-theme="dark"]` block and toggle it. The component should switch without code changes.
5. Run the grep again. Track the number going down over the coming weeks.
