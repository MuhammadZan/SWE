## Scenario

Your ERP product's UI was built by four different contractors. There are three shades of "error red," two modal implementations (one of which doesn't trap focus), and card padding ranges from 12px to 20px depending on the screen. A large customer now requires a dark theme for warehouse terminals, and a white-label partner wants their own brand color.

You're going to build the foundation that makes those requests a configuration change instead of a rewrite: a small **token-driven component library** with `Alert`, `Card` and `Modal`, where **no component contains a hardcoded hex string or a raw padding/margin number.** Every visual metric comes from a centralized theme layer.

## Starting point

Use any React setup you like: Vite + React + TS, or a Next.js app router page. Styling can be CSS Modules, plain CSS with custom properties, Tailwind (with tokens mapped into the theme), or vanilla-extract. Choose one and use it consistently.

A suggested structure:

```
src/
  tokens/
    primitives.ts     // raw palette + scales (the only place hex/px values live)
    semantic.ts       // meaning-based names mapped to primitives
    themes.css        // CSS variables for :root and [data-theme="dark"] (+ one brand theme)
  components/
    Alert/  Alert.tsx  Alert.test.tsx
    Card/   Card.tsx   Card.test.tsx
    Modal/  Modal.tsx  Modal.test.tsx
  demo/
    App.tsx           // a page showing every component in every variant + a theme switcher
```

Starter primitives to extend:

```ts
export const palette = {
  slate: { 50: "#f8fafc", 200: "#e2e8f0", 700: "#334155", 900: "#0f172a" },
  red:   { 50: "#fef2f2", 600: "#dc2626", 800: "#991b1b" },
  amber: { 50: "#fffbeb", 600: "#d97706", 800: "#92400e" },
  green: { 50: "#f0fdf4", 600: "#16a34a", 800: "#166534" },
  blue:  { 50: "#eff6ff", 600: "#2563eb", 800: "#1e40af" },
} as const;
export const space = { 0: "0", 1: "4px", 2: "8px", 3: "12px", 4: "16px", 5: "24px", 6: "32px" } as const;
```

## What to build

1. **Token tiers.** Primitive tokens (palette, spacing scale, radius scale, font-size scale, shadow scale) and semantic tokens (`color.surface.*`, `color.text.*`, `color.border.*`, `color.{info|success|warning|danger}.{fg|bg|border}`, `space.inset.*`, `radius.surface`, and so on). Components may only use semantic tokens.
2. **Three themes:** light (default), dark, and one "brand" theme (for example a white-label partner with a different accent), all switched with a `data-theme` attribute and no component changes.
3. **`Alert`** with `tone: "info" | "success" | "warning" | "danger"`, a `title`, optional body content, and an optional dismiss button. Use the correct ARIA role (`alert` for danger, `status` for the others).
4. **`Card`** built with composition: `Card`, `Card.Header` (title plus optional action slot), `Card.Body`, `Card.Footer`. Padding and dividers come from tokens.
5. **`Modal`** with `open`, `onClose`, `title` and children, and a footer slot for actions. Escape closes it, focus is trapped inside while open and returned to the trigger on close, and it uses `aria-modal` and `aria-labelledby`. Use native `<dialog>` or write the focus trap yourself. Don't use a prebuilt modal library.
6. **A demo page** showing an ERP-like scenario: a "Stock valuation" card, an "Invoice INV-2026-0042 is overdue" danger alert, and a "Void invoice?" confirmation modal, plus a theme switcher.
7. **An automated guard** that fails if a hex color or raw `px`/`rem` number appears in `src/components/**`. This can be an ESLint rule, a stylelint rule, or a small test that scans the files.

## Constraints

- Zero hex/rgb/hsl literals and zero raw spacing numbers in `src/components/**`. They're allowed only in `src/tokens/**`.
- Component props are strictly typed. There's no `color: string` or `style` escape hatch on `Alert`, `Card` or `Modal`.
- Every semantic text/background pair used by `Alert` must meet WCAG AA contrast (4.5:1) in both light and dark themes. Check it with a contrast tool and record the results.
- No UI component library (no MUI, Chakra or shadcn copy-paste). Headless primitives are allowed only for the stretch goals.

## How to verify

- Run the token guard. It passes. Then temporarily add `color: "#ff0000"` to `Alert` and confirm the guard fails.
- Toggle light, dark and brand on the demo page. Every component restyles correctly without a reload.
- Change one primitive (for example `red.600`) and confirm that every danger-toned element updates.
- Keyboard-test the modal: Tab cycles inside it, Shift+Tab wraps, Escape closes it, and focus returns to the "Void invoice" button.
- Component tests (Testing Library) cover the ARIA role per tone, modal closing on Escape, and `onClose` being called.
- `tsc --noEmit` rejects `<Alert tone="error" />`.
