import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCatalog, getPhase, phases } from "@/lib/content";
import { LessonCheck, PhaseProgress, ProblemBadge } from "@/components/Status";
import { Breadcrumbs, KindTag, ResourceList } from "@/components/ui";
import { Icon } from "@/components/Icon";

export function generateStaticParams() {
  return phases.map((p) => ({ phase: p.slug }));
}

export async function generateMetadata(props: PageProps<"/phases/[phase]">): Promise<Metadata> {
  const { phase } = await props.params;
  return { title: getPhase(phase)?.title ?? "Phase" };
}

export default async function PhasePage(props: PageProps<"/phases/[phase]">) {
  const { phase: slug } = await props.params;
  const phase = getPhase(slug);
  if (!phase) notFound();
  const catalogPhase = getCatalog().find((p) => p.id === phase.id)!;
  const totalMinutes = phase.lessons.reduce((a, l) => a + l.minutes, 0);
  const totalHours = phase.problems.reduce((a, p) => a + p.estimatedHours, 0);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:py-12">
      <Breadcrumbs items={[{ label: "Dashboard", href: "/" }, { label: `Phase ${phase.id}` }]} />

      <header className="mt-5 flex flex-col gap-6 border-b border-border pb-8 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl">
          <p className="font-mono text-xs tracking-wider text-accent uppercase">Phase {phase.id}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance">{phase.title}</h1>
          <p className="mt-2 text-muted">{phase.tagline}</p>
        </div>
        <PhaseProgress phase={catalogPhase} />
      </header>

      <section className="mt-8 grid gap-8 lg:grid-cols-[1fr_17rem]">
        <div>
          <div className="rounded-xl border-l-2 border-accent bg-accent-soft/60 px-4 py-3 text-sm">
            <span className="font-medium">Objective. </span>
            {phase.objective}
          </div>
          <div className="mt-5 space-y-3 text-pretty text-muted">
            {phase.overview.split("\n\n").map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>

          <h2 className="mt-10 mb-3 flex items-baseline justify-between text-lg font-semibold tracking-tight">
            Lessons
            <span className="text-xs font-normal text-muted">~{Math.round(totalMinutes / 60)}h total</span>
          </h2>
          <ol className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {phase.lessons.map((l, i) => (
              <li key={l.slug}>
                <Link href={`/lessons/${l.slug}`} className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-surface-2">
                  <span className="w-5 font-mono text-xs text-subtle tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{l.title}</span>
                    <span className="mt-0.5 block text-sm text-muted">{l.summary}</span>
                  </span>
                  <span className="hidden items-center gap-1 text-xs text-subtle sm:flex">
                    <Icon name="clock" className="size-3.5" />
                    {l.minutes}m
                  </span>
                  <LessonCheck slug={l.slug} />
                </Link>
              </li>
            ))}
          </ol>

          <h2 className="mt-10 mb-3 flex items-baseline justify-between text-lg font-semibold tracking-tight">
            Problems
            <span className="text-xs font-normal text-muted">~{totalHours}h of building</span>
          </h2>
          <ul className="grid gap-3">
            {phase.problems.map((p) => (
              <li key={p.slug}>
                <Link
                  href={`/problems/${p.slug}`}
                  className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border-strong sm:flex-row sm:items-center sm:gap-4"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <KindTag kind={p.kind} />
                      {p.needsDiagram && (
                        <span className="inline-flex items-center gap-1 text-[0.7rem] text-muted">
                          <Icon name="pen" className="size-3" /> whiteboard
                        </span>
                      )}
                    </span>
                    <span className="mt-1.5 block font-medium">{p.title}</span>
                    <span className="mt-0.5 block text-sm text-muted">{p.summary}</span>
                  </span>
                  <span className="flex items-center gap-3 sm:flex-col sm:items-end">
                    <ProblemBadge slug={p.slug} />
                    <span className="text-xs text-subtle">~{p.estimatedHours}h</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <aside className="lg:sticky lg:top-8 lg:self-start">
          <h2 className="mb-3 text-xs font-medium tracking-wider text-subtle uppercase">Recommended sources</h2>
          <ResourceList resources={phase.sources} />
        </aside>
      </section>
    </div>
  );
}
