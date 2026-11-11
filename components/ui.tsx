import Link from "next/link";
import type { Resource } from "@/lib/types";
import { Icon } from "./Icon";

export const kindLabel = { exercise: "Exercise", design: "Design", capstone: "Capstone" } as const;

export function KindTag({ kind }: { kind: keyof typeof kindLabel }) {
  const styles = {
    exercise: "border-border text-muted",
    design: "border-accent/30 bg-accent-soft text-accent",
    capstone: "border-warn/30 bg-warn-soft text-warn",
  }[kind];
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[0.7rem] font-medium ${styles}`}>
      {kindLabel[kind]}
    </span>
  );
}

export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav className="flex flex-wrap items-center gap-1.5 text-xs text-muted" aria-label="Breadcrumb">
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-subtle">/</span>}
          {it.href ? (
            <Link href={it.href} className="hover:text-fg">
              {it.label}
            </Link>
          ) : (
            <span className="text-fg">{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function ResourceList({ resources }: { resources: Resource[] }) {
  return (
    <ul className="space-y-1.5">
      {resources.map((r) => (
        <li key={r.url + r.label}>
          <a
            href={r.url}
            target="_blank"
            rel="noreferrer"
            className="group flex items-start gap-2 text-sm text-muted hover:text-fg"
          >
            <Icon name="external" className="mt-0.5 size-3.5 shrink-0 text-subtle group-hover:text-accent" />
            <span>
              {r.label}
              <span className="ml-1.5 font-mono text-[0.68rem] text-subtle uppercase">{r.kind}</span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function PrevNext({
  prev,
  next,
}: {
  prev: { href: string; title: string } | null;
  next: { href: string; title: string } | null;
}) {
  return (
    <div className="mt-12 grid gap-3 border-t border-border pt-6 sm:grid-cols-2">
      {prev ? (
        <Link href={prev.href} className="rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border-strong">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <Icon name="arrowLeft" className="size-3.5" /> Previous
          </div>
          <div className="mt-1 text-sm font-medium">{prev.title}</div>
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link
          href={next.href}
          className="rounded-xl border border-border bg-surface p-4 text-right transition-colors hover:border-border-strong"
        >
          <div className="flex items-center justify-end gap-1.5 text-xs text-muted">
            Next <Icon name="arrowRight" className="size-3.5" />
          </div>
          <div className="mt-1 text-sm font-medium">{next.title}</div>
        </Link>
      )}
    </div>
  );
}
