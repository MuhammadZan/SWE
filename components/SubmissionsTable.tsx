"use client";

import Link from "next/link";
import type { Catalog } from "@/lib/catalog";
import { useProgress } from "@/lib/progress";
import { ProblemBadge } from "./Status";
import { Icon } from "./Icon";
import { KindTag } from "./ui";

export function SubmissionsTable({ catalog }: { catalog: Catalog }) {
  const state = useProgress();
  return (
    <div className="mt-8 space-y-8">
      {catalog.map((phase) => (
        <section key={phase.id}>
          <h2 className="mb-2 text-sm font-medium text-muted">
            <span className="font-mono text-subtle">Phase {phase.id}</span> · {phase.title}
          </h2>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {phase.problems.map((pr) => {
              const latest = state.problems[pr.slug]?.submissions.at(-1);
              return (
                <li key={pr.slug} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <KindTag kind={pr.kind} />
                    <Link href={`/problems/${pr.slug}`} className="truncate text-sm font-medium hover:text-accent">
                      {pr.title}
                    </Link>
                  </div>
                  {latest ? (
                    <a
                      href={latest.repoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 font-mono text-xs text-muted hover:text-fg"
                    >
                      <Icon name="github" className="size-3.5" />
                      {latest.repoUrl.replace("https://github.com/", "")}
                    </a>
                  ) : (
                    <Link href={`/problems/${pr.slug}#submit`} className="text-xs text-muted hover:text-fg">
                      Submit →
                    </Link>
                  )}
                  <ProblemBadge slug={pr.slug} />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
