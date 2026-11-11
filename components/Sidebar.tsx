"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { initStore, syncStatus } from "@/lib/store";
import type { Catalog } from "@/lib/catalog";
import { courseStats, phaseStats, useHydrated, useProgress } from "@/lib/progress";
import { ProgressRing } from "./ProgressRing";
import { ThemeToggle } from "./ThemeToggle";
import { Icon } from "./Icon";

export function Sidebar({ catalog }: { catalog: Catalog }) {
  const pathname = usePathname();
  const state = useProgress();
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const stats = courseStats(catalog, state);

  // Close the mobile drawer on navigation.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
  }, [open]);

  useEffect(() => {
    void initStore();
  }, []);
  const sync = useSyncExternalStore(syncStatus.subscribe, syncStatus.get, () => "loading" as const);

  const activePhase = catalog.find(
    (p) =>
      pathname === `/phases/${p.slug}` ||
      p.lessons.some((l) => pathname === `/lessons/${l.slug}`) ||
      p.problems.some((pr) => pathname === `/problems/${pr.slug}`),
  );

  const nav = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center justify-between px-5 pt-5 pb-4">
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-fg text-bg">
            <Icon name="compass" className="size-4" />
          </span>
          <span className="leading-tight">
            <span className="block text-[0.95rem] font-semibold tracking-tight">Engineer Journal</span>
            <span className="block text-xs text-muted">SWE transition roadmap</span>
          </span>
        </Link>
        <ThemeToggle />
      </div>

      <div className="mx-5 mb-4 flex items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-3">
        <ProgressRing value={hydrated ? stats.pct : 0} size={38} stroke={4} />
        <div className="text-sm leading-tight">
          <div className="font-medium">{hydrated ? stats.pct : 0}% complete</div>
          <div className="text-xs text-muted">
            {stats.lessonsDone}/{stats.lessonsTotal} lessons · {stats.problemsDone}/{stats.problemsTotal} problems
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-6">
        <NavLink href="/" icon="home" active={pathname === "/"}>
          Dashboard
        </NavLink>
        <NavLink href="/whiteboard" icon="pen" active={pathname.startsWith("/whiteboard")}>
          Whiteboard
        </NavLink>
        <NavLink href="/submissions" icon="github" active={pathname === "/submissions"}>
          Submissions
        </NavLink>
        <NavLink href="/progress" icon="chart" active={pathname === "/progress"}>
          Progress
        </NavLink>

        <div className="mt-6 mb-2 px-2 text-[0.7rem] font-medium tracking-wider text-subtle uppercase">Phases</div>
        {catalog.map((p) => {
          const s = phaseStats(p, state);
          const expanded = activePhase?.id === p.id;
          return (
            <div key={p.id} className="mb-0.5">
              <Link
                href={`/phases/${p.slug}`}
                className={`flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition-colors ${
                  pathname === `/phases/${p.slug}` ? "bg-surface-2 font-medium" : "hover:bg-surface-2"
                }`}
              >
                <span className="grid size-6 shrink-0 place-items-center rounded-md border border-border bg-surface font-mono text-[0.7rem] text-muted">
                  {p.id}
                </span>
                <span className="min-w-0 flex-1 truncate">{p.title}</span>
                <span className="font-mono text-[0.7rem] text-subtle tabular-nums">{hydrated ? `${s.pct}%` : ""}</span>
              </Link>
              {expanded && (
                <ul className="mt-1 mb-2 ml-[1.15rem] border-l border-border pl-3">
                  {p.lessons.map((l) => (
                    <SubItem
                      key={l.slug}
                      href={`/lessons/${l.slug}`}
                      active={pathname === `/lessons/${l.slug}`}
                      done={!!state.lessons[l.slug]}
                    >
                      {l.title}
                    </SubItem>
                  ))}
                  <li className="mt-2 mb-1 text-[0.68rem] font-medium tracking-wider text-subtle uppercase">Problems</li>
                  {p.problems.map((pr) => (
                    <SubItem
                      key={pr.slug}
                      href={`/problems/${pr.slug}`}
                      active={pathname === `/problems/${pr.slug}`}
                      done={state.problems[pr.slug]?.status === "submitted"}
                    >
                      {pr.title}
                    </SubItem>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2 border-t border-border px-5 py-3 text-[0.7rem] text-subtle" role="status">
        <span
          className={`size-1.5 rounded-full ${
            sync === "synced" ? "bg-ok" : sync === "offline" ? "bg-warn" : "animate-pulse bg-subtle"
          }`}
        />
        {sync === "synced" && "Saved to disk"}
        {sync === "saving" && "Saving…"}
        {sync === "loading" && "Loading progress…"}
        {sync === "offline" && "Server unreachable: kept in browser, will retry"}
      </div>
    </nav>
  );

  return (
    <>
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-bg/90 px-4 py-3 backdrop-blur lg:hidden">
        <Link href="/" className="font-semibold tracking-tight">
          Engineer Journal
        </Link>
        <button
          onClick={() => setOpen(true)}
          className="rounded-lg border border-border bg-surface p-2"
          aria-label="Open navigation"
        >
          <Icon name="menu" className="size-4" />
        </button>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[19rem] max-w-[85vw] border-r border-border bg-bg shadow-xl">{nav}</div>
        </div>
      )}
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-72 shrink-0 border-r border-border bg-bg lg:block">{nav}</aside>
    </>
  );
}

function NavLink({
  href,
  icon,
  active,
  children,
}: {
  href: string;
  icon: Parameters<typeof Icon>[0]["name"];
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition-colors ${
        active ? "bg-surface-2 font-medium text-fg" : "text-muted hover:bg-surface-2 hover:text-fg"
      }`}
    >
      <Icon name={icon} className="size-4" />
      {children}
    </Link>
  );
}

function SubItem({
  href,
  active,
  done,
  children,
}: {
  href: string;
  active: boolean;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-[0.82rem] leading-snug transition-colors ${
          active ? "bg-surface-2 font-medium text-fg" : "text-muted hover:text-fg"
        }`}
      >
        <span
          className={`mt-[0.3rem] size-2 shrink-0 rounded-full ${done ? "bg-ok" : "border border-border-strong"}`}
          aria-label={done ? "done" : "not done"}
        />
        <span>{children}</span>
      </Link>
    </li>
  );
}
