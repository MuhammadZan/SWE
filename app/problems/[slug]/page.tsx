import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getProblem, lessonTitle, phases } from "@/lib/content";
import { Markdown } from "@/components/Markdown";
import { Workspace } from "@/components/Workspace";
import { TrackVisit } from "@/components/TrackVisit";
import { Breadcrumbs, KindTag, PrevNext } from "@/components/ui";
import { ProblemBadge } from "@/components/Status";
import { Icon } from "@/components/Icon";

export function generateStaticParams() {
  return phases.flatMap((p) => p.problems.map((pr) => ({ slug: pr.slug })));
}

export async function generateMetadata(props: PageProps<"/problems/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  return { title: getProblem(slug)?.problem.title ?? "Problem" };
}

export default async function ProblemPage(props: PageProps<"/problems/[slug]">) {
  const { slug } = await props.params;
  const data = getProblem(slug);
  if (!data) notFound();
  const { phase, problem, brief, solution, prev, next } = data;
  const related = problem.relatedLessons.map((s) => ({ slug: s, title: lessonTitle(s) }));

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8 lg:py-10">
      <TrackVisit href={`/problems/${slug}`} title={problem.title} />
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: "/" },
          { label: `Phase ${phase.id}: ${phase.title}`, href: `/phases/${phase.slug}` },
          { label: problem.title },
        ]}
      />
      <header className="mt-5 mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <KindTag kind={problem.kind} />
            <span className="inline-flex items-center gap-1 text-xs text-muted">
              <Icon name="clock" className="size-3.5" /> ~{problem.estimatedHours}h
            </span>
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance">{problem.title}</h1>
          <p className="mt-2 text-pretty text-muted">{problem.summary}</p>
        </div>
        <ProblemBadge slug={slug} />
      </header>

      <Workspace problem={problem} related={related} solution={solution ? <Markdown>{solution}</Markdown> : null}>
        <Markdown>{brief}</Markdown>
      </Workspace>

      <PrevNext prev={prev} next={next} />
    </div>
  );
}
