import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getLesson, headingsOf, phases } from "@/lib/content";
import { Markdown } from "@/components/Markdown";
import { Quiz } from "@/components/Quiz";
import { CompleteLesson } from "@/components/CompleteLesson";
import { TrackVisit } from "@/components/TrackVisit";
import { Breadcrumbs, PrevNext, ResourceList } from "@/components/ui";
import { Icon } from "@/components/Icon";

export function generateStaticParams() {
  return phases.flatMap((p) => p.lessons.map((l) => ({ slug: l.slug })));
}

export async function generateMetadata(props: PageProps<"/lessons/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  return { title: getLesson(slug)?.lesson.title ?? "Lesson" };
}

export default async function LessonPage(props: PageProps<"/lessons/[slug]">) {
  const { slug } = await props.params;
  const data = getLesson(slug);
  if (!data) notFound();
  const { phase, lesson, body, index, prev, next } = data;
  const toc = headingsOf(body);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8 lg:py-12">
      <TrackVisit href={`/lessons/${slug}`} title={lesson.title} />
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: "/" },
          { label: `Phase ${phase.id}: ${phase.title}`, href: `/phases/${phase.slug}` },
          { label: `Lesson ${index + 1}` },
        ]}
      />

      <div className="mt-6 grid gap-10 xl:grid-cols-[minmax(0,1fr)_15rem]">
        <article className="min-w-0">
          <header className="mb-8 border-b border-border pb-6">
            <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-[2.1rem]">{lesson.title}</h1>
            <p className="mt-3 max-w-2xl text-lg text-pretty text-muted">{lesson.summary}</p>
            <div className="mt-4 flex items-center gap-4 text-xs text-muted">
              <span className="inline-flex items-center gap-1.5">
                <Icon name="clock" className="size-3.5" /> {lesson.minutes} min
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Icon name="bulb" className="size-3.5" /> {lesson.quiz.length}-question check
              </span>
            </div>
          </header>

          <Markdown>{body}</Markdown>

          <section className="mt-12 max-w-[72ch] rounded-2xl border border-border bg-surface p-6">
            <h2 className="text-sm font-semibold tracking-wider text-subtle uppercase">Key takeaways</h2>
            <ul className="mt-3 space-y-2">
              {lesson.keyTakeaways.map((t) => (
                <li key={t} className="flex gap-2.5 text-[0.95rem]">
                  <Icon name="check" className="mt-1 size-4 shrink-0 text-accent" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </section>

          <Quiz slug={slug} questions={lesson.quiz} />
          <CompleteLesson slug={slug} />

          {lesson.resources.length > 0 && (
            <section className="mt-10 max-w-[72ch]">
              <h2 className="mb-3 text-sm font-semibold tracking-wider text-subtle uppercase">Go deeper</h2>
              <ResourceList resources={lesson.resources} />
            </section>
          )}

          <PrevNext prev={prev} next={next} />
        </article>

        {toc.length > 0 && (
          <aside className="hidden xl:block">
            <div className="sticky top-8">
              <div className="mb-3 text-xs font-medium tracking-wider text-subtle uppercase">On this page</div>
              <ul className="space-y-1.5 border-l border-border text-sm">
                {toc.map((h) => (
                  <li key={h.id}>
                    <a href={`#${h.id}`} className="-ml-px block border-l border-transparent pl-3 text-muted hover:border-fg hover:text-fg">
                      {h.text}
                    </a>
                  </li>
                ))}
                <li>
                  <a href="#quiz" className="-ml-px block border-l border-transparent pl-3 text-muted hover:border-fg hover:text-fg">
                    Check your understanding
                  </a>
                </li>
              </ul>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
