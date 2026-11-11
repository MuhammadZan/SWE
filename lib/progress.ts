"use client";

// Local-first progress store. Everything lives in this browser's localStorage;
// use Export / Import on the Progress page to back it up or move machines.
import { useSyncExternalStore } from "react";
import type { Catalog, CatalogPhase } from "./catalog";

export type Submission = {
  repoUrl: string;
  notes: string;
  submittedAt: string; // ISO
  verified: boolean; // GitHub API confirmed the repo is public
};

export type ProblemProgress = {
  status: "in-progress" | "submitted";
  startedAt: string;
  checks: Record<string, boolean>; // requirement / rubric checkboxes keyed "req-0", "rub-2"
  hintsRevealed: number;
  submissions: Submission[]; // newest last
};

export type ProgressState = {
  version: 1;
  lessons: Record<string, { completedAt: string }>;
  quizzes: Record<string, { score: number; total: number; at: string }>;
  problems: Record<string, ProblemProgress>;
  lastVisited?: { href: string; title: string; at: string };
};

const KEY = "sej:progress:v1";
const EMPTY: ProgressState = { version: 1, lessons: {}, quizzes: {}, problems: {} };

let cache: ProgressState | null = null;
const listeners = new Set<() => void>();

function read(): ProgressState {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { ...EMPTY, ...(JSON.parse(raw) as ProgressState) } : EMPTY;
  } catch {
    cache = EMPTY;
  }
  return cache;
}

function write(next: ProgressState) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage full or blocked: keep in-memory state */
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useProgress(): ProgressState {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

/** True once the client has read localStorage (avoids flashing empty progress). */
export function useHydrated() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

const now = () => new Date().toISOString();

export const progress = {
  update(fn: (s: ProgressState) => ProgressState) {
    write(fn(read()));
  },
  setLessonComplete(slug: string, done: boolean) {
    this.update((s) => {
      const lessons = { ...s.lessons };
      if (done) lessons[slug] = { completedAt: now() };
      else delete lessons[slug];
      return { ...s, lessons };
    });
  },
  recordQuiz(slug: string, score: number, total: number) {
    this.update((s) => ({ ...s, quizzes: { ...s.quizzes, [slug]: { score, total, at: now() } } }));
  },
  problem(slug: string): ProblemProgress {
    return (
      read().problems[slug] ?? { status: "in-progress", startedAt: now(), checks: {}, hintsRevealed: 0, submissions: [] }
    );
  },
  patchProblem(slug: string, patch: Partial<ProblemProgress>) {
    this.update((s) => ({ ...s, problems: { ...s.problems, [slug]: { ...this.problem(slug), ...patch } } }));
  },
  toggleCheck(slug: string, key: string) {
    const p = this.problem(slug);
    this.patchProblem(slug, { checks: { ...p.checks, [key]: !p.checks[key] } });
  },
  submit(slug: string, sub: Omit<Submission, "submittedAt">) {
    const p = this.problem(slug);
    this.patchProblem(slug, { status: "submitted", submissions: [...p.submissions, { ...sub, submittedAt: now() }] });
  },
  visit(href: string, title: string) {
    const s = read();
    if (s.lastVisited?.href === href) return;
    write({ ...s, lastVisited: { href, title, at: now() } });
  },
  export(): string {
    return JSON.stringify(read(), null, 2);
  },
  import(json: string) {
    const parsed = JSON.parse(json) as ProgressState;
    if (parsed?.version !== 1 || typeof parsed.lessons !== "object") throw new Error("Not a valid progress file");
    write({ ...EMPTY, ...parsed });
  },
  reset() {
    write(EMPTY);
  },
};

// ---------- derived stats ----------

export function phaseStats(phase: CatalogPhase, s: ProgressState) {
  const lessonsDone = phase.lessons.filter((l) => s.lessons[l.slug]).length;
  const problemsDone = phase.problems.filter((p) => s.problems[p.slug]?.status === "submitted").length;
  const total = phase.lessons.length + phase.problems.length;
  const done = lessonsDone + problemsDone;
  return {
    lessonsDone,
    lessonsTotal: phase.lessons.length,
    problemsDone,
    problemsTotal: phase.problems.length,
    done,
    total,
    pct: total ? Math.round((done / total) * 100) : 0,
  };
}

export function courseStats(catalog: Catalog, s: ProgressState) {
  const per = catalog.map((p) => phaseStats(p, s));
  const done = per.reduce((a, b) => a + b.done, 0);
  const total = per.reduce((a, b) => a + b.total, 0);
  return {
    per,
    done,
    total,
    pct: total ? Math.round((done / total) * 100) : 0,
    lessonsDone: per.reduce((a, b) => a + b.lessonsDone, 0),
    lessonsTotal: per.reduce((a, b) => a + b.lessonsTotal, 0),
    problemsDone: per.reduce((a, b) => a + b.problemsDone, 0),
    problemsTotal: per.reduce((a, b) => a + b.problemsTotal, 0),
  };
}

/** First lesson/problem not yet done, in course order. */
export function nextStep(catalog: Catalog, s: ProgressState) {
  for (const p of catalog) {
    for (const l of p.lessons) if (!s.lessons[l.slug]) return { href: `/lessons/${l.slug}`, title: l.title, phase: p };
    for (const pr of p.problems)
      if (s.problems[pr.slug]?.status !== "submitted") return { href: `/problems/${pr.slug}`, title: pr.title, phase: p };
  }
  return null;
}

// ---------- GitHub link validation ----------

const GH_RE = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})(\/.*)?$/;

export function parseGitHubUrl(url: string) {
  const m = url.trim().replace(/\.git$/, "").match(GH_RE);
  if (!m) return null;
  return { owner: m[1], repo: m[2], rest: m[3] ?? "" };
}

export type RepoCheck =
  | { ok: true; verified: true; fullName: string; description: string | null; pushedAt: string | null }
  | { ok: true; verified: false; reason: string }
  | { ok: false; reason: string };

/** Confirms the repo exists and is public using the unauthenticated GitHub API. */
export async function checkGitHubRepo(url: string): Promise<RepoCheck> {
  const parsed = parseGitHubUrl(url);
  if (!parsed) return { ok: false, reason: "Use a link like https://github.com/you/repo" };
  try {
    const res = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (res.status === 404) return { ok: false, reason: "Repo not found. It may be private or misspelled." };
    if (res.status === 403 || res.status === 429)
      return { ok: true, verified: false, reason: "GitHub rate limit hit, so the repo could not be checked. Saved anyway." };
    if (!res.ok) return { ok: true, verified: false, reason: `GitHub returned ${res.status}. Saved without verification.` };
    const data = (await res.json()) as { private: boolean; full_name: string; description: string | null; pushed_at: string | null };
    if (data.private) return { ok: false, reason: "That repo is private. Make it public to submit." };
    return { ok: true, verified: true, fullName: data.full_name, description: data.description, pushedAt: data.pushed_at };
  } catch {
    return { ok: true, verified: false, reason: "Offline or GitHub unreachable. Saved without verification." };
  }
}
