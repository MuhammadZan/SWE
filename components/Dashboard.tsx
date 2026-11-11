"use client";

import Link from "next/link";
import type { Catalog } from "@/lib/catalog";
import { courseStats, nextStep, phaseStats, useHydrated, useProgress } from "@/lib/progress";
import { Icon } from "./Icon";
import { ProgressBar, ProgressRing } from "./ProgressRing";

type Blurbs = Record<number, { tagline: string; objective: string }>;

export function Dashboard({ catalog, blurbs }: { catalog: Catalog; blurbs: Blurbs }) {
  const state = useProgress();
  const hydrated = useHydrated();
  const stats = courseStats(catalog, state);
  const next = nextStep(catalog, state);
  const resume = state.lastVisited;

  const recent = Object.entries(state.problems)
    .flatMap(([slug, p]) => p.submissions.map((s) => ({ slug, ...s })))
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    .slice(0, 4);
  const titleOf = (slug: string) =>
    catalog.flatMap((p) => p.problems).find((p) => p.slug === slug)?.title ?? slug;

  const started = hydrated && (stats.done > 0 || !!resume);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8 lg:py-12">
      {/* Hero */}
      <section className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div>
          <p className="font-mono text-xs tracking-wider text-accent uppercase">Software engineering transition</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            {started ? "Welcome back." : "From shipping apps to engineering systems."}
          </h1>
          <p className="mt-3 max-w-2xl text-pretty text-muted">
            Six phases, from engineering foundations through architecture, performance, system design, delivery and
            production databases. Read the lesson, check yourself with the quiz, build the real thing, submit it as a
            public GitHub repo, then grade it against the solution notes.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {next && (
              <Link
                href={started && resume ? resume.href : next.href}
                className="inline-flex items-center gap-2 rounded-lg bg-fg px-4 py-2.5 text-sm font-medium text-bg transition-opacity hover:opacity-90"
              >
                {started && resume ? "Continue" : "Start the course"}
                <Icon name="arrowRight" className="size-4" />
              </Link>
            )}
            <Link
              href="/whiteboard"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-medium transition-colors hover:bg-surface-2"
            >
              <Icon name="pen" className="size-4" /> Open whiteboard
            </Link>
          </div>
          {started && resume && (
            <p className="mt-3 text-sm text-muted">
              Last opened: <span className="text-fg">{resume.title}</span>
              {next && next.href !== resume.href && (
                <>
                  {" · "}Next up:{" "}
                  <Link href={next.href} className="text-accent underline-offset-2 hover:underline">
                    {next.title}
                  </Link>
                </>
              )}
            </p>
          )}
        </div>

        <div className="flex items-center gap-5 rounded-2xl border border-border bg-surface p-5">
          <ProgressRing value={hydrated ? stats.pct : 0} size={88} stroke={7} />
          <div className="space-y-1.5 text-sm">
            <div className="text-2xl font-semibold tabular-nums">{hydrated ? stats.pct : 0}%</div>
            <div className="text-muted">
              <span className="text-fg tabular-nums">{stats.lessonsDone}</span>/{stats.lessonsTotal} lessons
            </div>
            <div className="text-muted">
              <span className="text-fg tabular-nums">{stats.problemsDone}</span>/{stats.problemsTotal} problems submitted
            </div>
          </div>
        </div>
      </section>

      {/* Phases */}
      <section className="mt-12">
        <h2 className="mb-4 text-sm font-medium tracking-wider text-subtle uppercase">The phases</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {catalog.map((p) => {
            const s = phaseStats(p, state);
            const capstone = p.problems.find((x) => x.kind === "capstone");
            return (
              <Link
                key={p.id}
                href={`/phases/${p.slug}`}
                className="group flex flex-col rounded-2xl border border-border bg-surface p-5 transition-colors hover:border-border-strong"
              >
                <div className="flex items-start justify-between gap-4">
                  <span className="font-mono text-xs text-subtle">Phase {p.id}</span>
                  <span className="font-mono text-xs text-muted tabular-nums">{hydrated ? `${s.pct}%` : ""}</span>
                </div>
                <h3 className="mt-1.5 text-lg font-semibold tracking-tight">{p.title}</h3>
                <p className="mt-1 text-sm text-muted">{blurbs[p.id]?.tagline}</p>
                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <Icon name="book" className="size-3.5" />
                    {s.lessonsDone}/{s.lessonsTotal} lessons
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Icon name="code" className="size-3.5" />
                    {s.problemsDone}/{s.problemsTotal} problems
                  </span>
                  {capstone && (
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="target" className="size-3.5" />
                      Capstone: {capstone.title}
                    </span>
                  )}
                </div>
                <ProgressBar value={hydrated ? s.pct : 0} className="mt-4" />
              </Link>
            );
          })}
        </div>
      </section>

      <section className="mt-12 grid gap-4 lg:grid-cols-[1fr_22rem]">
        {/* Recent submissions */}
        <div className="rounded-2xl border border-border bg-surface p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium">Recent submissions</h2>
            <Link href="/submissions" className="text-xs text-muted hover:text-fg">
              View all
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="py-6 text-sm text-muted">
              Nothing submitted yet. Each problem ends with a public GitHub repo you link here.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((r) => (
                <li key={r.slug + r.submittedAt} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                  <Link href={`/problems/${r.slug}`} className="min-w-0 truncate hover:text-accent">
                    {titleOf(r.slug)}
                  </Link>
                  <a
                    href={r.repoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex shrink-0 items-center gap-1.5 font-mono text-xs text-muted hover:text-fg"
                  >
                    <Icon name="github" className="size-3.5" />
                    {r.repoUrl.replace("https://github.com/", "")}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Mandate */}
        <div className="rounded-2xl border border-border bg-surface-2 p-5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Icon name="shield" className="size-4 text-accent" />
            The anti-AI mandate
          </div>
          <p className="mt-2 text-sm text-pretty text-muted">
            Write all core logic, structure, and configuration by hand. Use AI only as a documentation lookup or syntax
            reference, never as the architect. The point is that the achievement is yours.
          </p>
        </div>
      </section>
    </div>
  );
}
