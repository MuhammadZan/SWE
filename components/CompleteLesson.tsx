"use client";

import { progress, useProgress } from "@/lib/progress";
import { Icon } from "./Icon";

export function CompleteLesson({ slug }: { slug: string }) {
  const done = !!useProgress().lessons[slug];
  return (
    <div
      className={`mt-8 flex max-w-[72ch] flex-col gap-3 rounded-2xl border p-5 sm:flex-row sm:items-center sm:justify-between ${
        done ? "border-ok/40 bg-ok-soft" : "border-border bg-surface"
      }`}
    >
      <div className="text-sm">
        <div className="font-medium">{done ? "Lesson complete" : "Finished reading and practising?"}</div>
        <div className="text-muted">
          {done ? "It counts toward your phase progress." : "Mark it done once you've worked through the Try it section."}
        </div>
      </div>
      <button
        onClick={() => progress.setLessonComplete(slug, !done)}
        className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
          done ? "border border-border bg-surface text-muted hover:text-fg" : "bg-accent text-accent-fg hover:opacity-90"
        }`}
      >
        {done ? (
          "Mark as not done"
        ) : (
          <>
            <Icon name="check" className="size-4" /> Mark complete
          </>
        )}
      </button>
    </div>
  );
}
