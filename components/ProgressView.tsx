"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { Catalog } from "@/lib/catalog";
import { courseStats, useHydrated, useProgress } from "@/lib/progress";
import { flush, getItem, initStore, keys, removeItem, setItem } from "@/lib/store";
import { Icon } from "./Icon";
import { ProgressBar } from "./ProgressRing";

const PREFIX = "sej:";

async function backup() {
  await initStore();
  const data: Record<string, string> = {};
  for (const k of keys()) data[k] = getItem(k)!;
  return JSON.stringify({ app: "engineer-journal", exportedAt: new Date().toISOString(), data }, null, 2);
}

async function restore(json: string) {
  const parsed = JSON.parse(json) as { app?: string; data?: Record<string, string> };
  if (parsed.app !== "engineer-journal" || !parsed.data) throw new Error("Not an Engineer Journal backup file");
  for (const [k, v] of Object.entries(parsed.data))
    if (k.startsWith(PREFIX) && !k.startsWith("sej:__") && k !== "sej:theme") setItem(k, v);
  await flush();
}

export function ProgressView({ catalog }: { catalog: Catalog }) {
  const state = useProgress();
  const hydrated = useHydrated();
  const stats = courseStats(catalog, state);
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const quizzes = Object.values(state.quizzes);
  const quizAvg = quizzes.length
    ? Math.round((quizzes.reduce((a, q) => a + q.score / q.total, 0) / quizzes.length) * 100)
    : null;

  async function download() {
    const blob = new Blob([await backup()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `engineer-journal-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await restore(await file.text());
      window.location.reload();
    } catch (err) {
      setMsg((err as Error).message);
    }
    e.target.value = "";
  }

  async function reset() {
    if (!confirm("Erase all progress, submissions and whiteboards? A copy stays in data/backups/ for 14 days.")) return;
    await initStore();
    keys().forEach((k) => removeItem(k));
    await flush();
    window.location.reload();
  }

  return (
    <div className="mt-8 space-y-8">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Overall" value={hydrated ? `${stats.pct}%` : "–"} />
        <Stat label="Lessons" value={`${stats.lessonsDone}/${stats.lessonsTotal}`} />
        <Stat label="Problems" value={`${stats.problemsDone}/${stats.problemsTotal}`} />
        <Stat label="Quiz average" value={quizAvg === null ? "–" : `${quizAvg}%`} />
      </div>

      <div className="space-y-4">
        {catalog.map((p, i) => {
          const s = stats.per[i];
          return (
            <section key={p.id} className="rounded-2xl border border-border bg-surface p-5">
              <div className="flex items-baseline justify-between gap-4">
                <Link href={`/phases/${p.slug}`} className="font-medium hover:text-accent">
                  <span className="mr-2 font-mono text-xs text-subtle">Phase {p.id}</span>
                  {p.title}
                </Link>
                <span className="font-mono text-sm tabular-nums">{hydrated ? s.pct : 0}%</span>
              </div>
              <ProgressBar value={hydrated ? s.pct : 0} className="mt-3" />
              <div className="mt-4 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                {p.lessons.map((l) => {
                  const q = state.quizzes[l.slug];
                  return (
                    <Link key={l.slug} href={`/lessons/${l.slug}`} className="flex items-center gap-2 text-muted hover:text-fg">
                      <Dot on={!!state.lessons[l.slug]} />
                      <span className="truncate">{l.title}</span>
                      {q && <span className="ml-auto font-mono text-[0.7rem] text-subtle">{q.score}/{q.total}</span>}
                    </Link>
                  );
                })}
                {p.problems.map((pr) => (
                  <Link key={pr.slug} href={`/problems/${pr.slug}`} className="flex items-center gap-2 text-muted hover:text-fg">
                    <Dot on={state.problems[pr.slug]?.status === "submitted"} square />
                    <span className="truncate">{pr.title}</span>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="font-medium">Backup & restore</h2>
        <p className="mt-1 text-sm text-muted">
          Everything is saved to <code className="font-mono text-xs">data/store/</code> in the project folder, with a
          daily snapshot in <code className="font-mono text-xs">data/backups/</code> (last 14 days). Clearing the
          browser doesn&apos;t touch it. Download a file to move progress to another machine.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={download} className="inline-flex items-center gap-2 rounded-lg bg-fg px-3.5 py-2 text-sm font-medium text-bg hover:opacity-90">
            <Icon name="download" className="size-4" /> Download backup
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3.5 py-2 text-sm font-medium hover:bg-surface-2"
          >
            <Icon name="upload" className="size-4" /> Restore from file
          </button>
          <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={onFile} />
          <button onClick={reset} className="ml-auto rounded-lg px-3.5 py-2 text-sm text-danger hover:bg-danger/10">
            Reset everything
          </button>
        </div>
        {msg && <p className="mt-3 text-sm text-danger">{msg}</p>}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Dot({ on, square }: { on: boolean; square?: boolean }) {
  return (
    <span
      className={`size-2.5 shrink-0 ${square ? "rounded-[3px]" : "rounded-full"} ${on ? "bg-ok" : "border border-border-strong"}`}
    />
  );
}
