## What a strong solution looks like

A strong submission has a clear dependency direction: primitives (raw hex and px values) are imported only by the theme layer; semantic tokens describe meaning (`surface`, `text.muted`, `danger.fg`, `inset.md`); components read only semantic tokens. Themes are pure CSS: `:root` for light, `[data-theme="dark"]` and `[data-theme="brand"]` remap the same semantic variables to different primitives. Changing a primitive updates every component that means it, and switching a theme touches no component code.

The components are small and hard to misuse. `Alert` takes a `Tone` union and has no `color`, `style` or `className` escape hatch. `Card` is a compound component. `Modal` wraps native `<dialog>`, labels itself with its title, closes on Escape, and returns focus to whatever opened it. An automated guard fails the test run when someone adds `#ff0000` or `13px` under `src/components/`, and component tests cover the behavior that matters: roles per tone, Escape, `onClose`, and focus return. The README contains a contrast table for every Alert text/background pair in both themes, with measured ratios rather than "looks fine".

## Reference approach

**Token layering.** One possible shape:

```css
/* src/tokens/themes.css (generated or hand-written from primitives.ts) */
:root {
  --space-2: 8px; --space-4: 16px; --radius-2: 8px;
  --color-surface: #ffffff;  --color-text: #0f172a;  --color-border: #e2e8f0;
  --color-danger-fg: #991b1b; --color-danger-bg: #fef2f2; --color-danger-border: #dc2626;
}
[data-theme="dark"] {
  --color-surface: #0f172a;  --color-text: #e2e8f0;  --color-border: #334155;
  --color-danger-fg: #fecaca; --color-danger-bg: #450a0a; --color-danger-border: #f87171;
}
[data-theme="brand"] { --color-accent: #7c3aed; /* only what differs from light */ }
```

```ts
// src/tokens/semantic.ts: components import this, never primitives.ts
export const t = {
  color: {
    danger: { fg: "var(--color-danger-fg)", bg: "var(--color-danger-bg)", border: "var(--color-danger-border)" },
    // info, success, warning ...
  },
  space: { inset: { sm: "var(--space-2)", md: "var(--space-4)" } },
  radius: { surface: "var(--radius-2)" },
} as const;
export type Tone = keyof Pick<typeof t.color, "info" | "success" | "warning" | "danger">;
```

Deriving `Tone` from the token object means adding a tone to the type without adding its tokens is a compile error.

**Modal.** Native dialog does most of the work, and focus return is handled explicitly:

```tsx
export function Modal({ open, onClose, title, children, footer }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    const trigger = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => { dialog.close(); trigger?.focus(); };
  }, [open]);
  return (
    <dialog ref={ref} aria-labelledby={titleId} aria-modal="true"
            onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <h2 id={titleId}>{title}</h2>
      {children}
      {footer && <div className={styles.footer}>{footer}</div>}
    </dialog>
  );
}
```

`onCancel` fires on Escape. Preventing the default and calling `onClose` keeps React's `open` prop the single source of truth instead of letting the browser close the dialog behind React's back.

**Guard.** A test is the simplest enforceable check:

```ts
it("components contain no raw colors or lengths", () => {
  const offenders = globSync("src/components/**/*.{ts,tsx,css}")
    .filter((f) => !f.endsWith(".test.tsx"))
    .flatMap((f) => readFileSync(f, "utf8").split("\n")
      .map((line, i) => ({ f, i: i + 1, line }))
      .filter(({ line }) => /#[0-9a-f]{3,8}\b|\b(rgb|hsl)a?\(|\b\d+(\.\d+)?(px|rem)\b/i.test(line)));
  expect(offenders).toEqual([]);
});
```

(`globSync` is available from `node:fs` in Node 22+, or from the `glob`/`fast-glob` packages.) Showing the file and line in the failure output makes the guard useful rather than annoying.

**Tests in jsdom.** jsdom lacks `showModal()`, so the setup file stubs it:

```ts
HTMLDialogElement.prototype.showModal ??= function () { this.setAttribute("open", ""); };
HTMLDialogElement.prototype.close ??= function () { this.removeAttribute("open"); };
```

With stubs, Escape won't trigger `cancel` automatically, so tests either dispatch a `cancel` event or run in Vitest browser mode/Playwright, where the real behavior is exercised. The strongest submissions test focus return in a real browser.

## Common mistakes

- **Semantic tokens named after colors** (`color.red`, `color.blue-light`). The brand theme then needs `--color-blue: purple`, which is a lie everyone has to remember.
- **Components importing primitives** "just this once" for a border. Now dark mode misses that border.
- **The guard only checks `.tsx`** while hex values hide in CSS modules, or it scans tokens too and has to be disabled.
- **`role="alert"` on every tone.** Screen readers interrupt the user for a success message. Only urgent messages should be assertive.
- **Focus not returned** after closing, so keyboard users land at the top of the page. This is the most common accessibility failure in the submissions.
- **Contrast checked only in light mode**, or by eye. Dark themes often fail on warning and success pairs.
- **`style` or `className` pass-through props** added "for flexibility", which quietly reopens every escape hatch the guard was meant to close.

## Trade-offs worth discussing

- **CSS variables versus a JS theme object.** Variables switch without re-rendering, work with SSR, and avoid a flash of the wrong theme if the attribute is set before paint. JS themes give richer type checks but cost re-renders and hydration complexity.
- **Native `<dialog>` versus a hand-written trap.** Native gives inertness and Escape for free, and focus restoration in current browsers, but needs stubs in jsdom. A hand-written trap is fully controllable and easy to test in jsdom, but you own its bugs. Headless libraries (Radix, React Aria) are what most teams choose in production.
- **Component tokens.** Adding `alert.danger.border` on top of semantic tokens is worth it for large multi-brand systems. For three components it is indirection without payoff.
- **Tailwind.** Mapping semantic tokens into `@theme` is efficient, but the guard must then also ban arbitrary values like `p-[13px]`.
- **Strictness versus adoption.** No escape hatches keeps the system consistent. A design system too rigid to cover a real screen gets bypassed. The usual answer is a fast process for adding new variants.

## Grade yourself

| Dimension | Strong | Acceptable | Needs work |
|---|---|---|---|
| Token tiers | Primitives imported only by theme files; semantic names express meaning; changing `red.600` updates every danger element | Semantic layer exists but a few components reference primitives | Hex values or value-named tokens used directly in components |
| Theming | Light, dark and brand switch at runtime via `data-theme`, no component changes, no flash on load | Themes work, but brand duplicates the whole palette or flashes on load | Theme switch requires component props or a reload |
| Typed APIs | `Tone` union derived from tokens; `tsc` rejects `tone="error"`; no style escape hatches | Union types but a `className` pass-through remains | `color: string` or `style` props |
| Modal accessibility | Escape, inert background, `aria-modal`/`aria-labelledby`, focus returns to trigger, all covered by tests | Works by manual keyboard testing, partial test coverage | Focus escapes to the page or is lost on close |
| Automated checks | Guard test with file/line output, component tests for roles, Escape, `onClose` and focus, one npm script | Guard plus a few component tests | No guard, or tests only render snapshots |
| Contrast evidence | Table with measured ratios for every Alert pair in both themes, all at least 4.5:1 | Ratios for light theme only, or a few pairs | No evidence |

## Going further

1. Generate `themes.css` and `semantic.ts` from a single JSON source in the Design Tokens Community Group format using Style Dictionary, so code and design tools share one source.
2. Add Playwright screenshot tests for each component in each theme, and fail CI on visual diffs.
3. Write a contrast-check script that reads the theme values and computes WCAG ratios automatically, so the contrast table can't go stale.
