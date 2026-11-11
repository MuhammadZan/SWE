"use client";

import { phaseStats, useHydrated, useProgress } from "@/lib/progress";
import type { CatalogPhase } from "@/lib/catalog";
import { Icon } from "./Icon";
import { ProgressBar } from "./ProgressRing";

export function LessonCheck({ slug }: { slug: string }) {
  const s = useProgress();
  const done = !!s.lessons[slug];
  const quiz = s.quizzes[slug];
  return (
    <span className="flex items-center gap-2">
      {quiz && (
        <span className="font-mono text-[0.7rem] text-subtle tabular-nums">
          quiz {quiz.score}/{quiz.total}
        </span>
      )}
      <span
        className={`grid size-5 place-items-center rounded-full ${done ? "bg-ok text-surface" : "border border-border-strong"}`}
        aria-label={done ? "Completed" : "Not completed"}
      >
        {done && <Icon name="check" className="size-3" />}
      </span>
    </span>
  );
}

export function ProblemBadge({ slug }: { slug: string }) {
  const s = useProgress();
  const p = s.problems[slug];
  if (!p) return <span className="text-xs text-subtle">Not started</span>;
  if (p.status === "submitted")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-ok-soft px-2 py-0.5 text-xs font-medium text-ok">
        <Icon name="check" className="size-3" /> Submitted
      </span>
    );
  return <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">In progress</span>;
}

export function PhaseProgress({ phase }: { phase: CatalogPhase }) {
  const s = useProgress();
  const hydrated = useHydrated();
  const st = phaseStats(phase, s);
  return (
    <div className="min-w-48">
      <div className="mb-1.5 flex justify-between text-xs text-muted">
        <span>
          {st.done}/{st.total} done
        </span>
        <span className="tabular-nums">{hydrated ? st.pct : 0}%</span>
      </div>
      <ProgressBar value={hydrated ? st.pct : 0} />
    </div>
  );
}
