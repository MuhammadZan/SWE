// Server-side content loader. Reads typed phase metadata plus markdown bodies from /content.
import fs from "node:fs";
import path from "node:path";
import { phase as phase0 } from "@/content/phase-0";
import { phase as phase1 } from "@/content/phase-1";
import { phase as phase2 } from "@/content/phase-2";
import { phase as phase3 } from "@/content/phase-3";
import { phase as phase4 } from "@/content/phase-4";
import { phase as phase5 } from "@/content/phase-5";
import type { LessonMeta, PhaseMeta, ProblemMeta } from "./types";
import type { Catalog } from "./catalog";
import { slugify } from "./slug";

export const phases: PhaseMeta[] = [phase0, phase1, phase2, phase3, phase4, phase5];

const CONTENT_DIR = path.join(process.cwd(), "content");

function readMarkdown(phaseId: number, kind: "lessons" | "problems" | "solutions", slug: string) {
  const file = path.join(CONTENT_DIR, `phase-${phaseId}`, kind, `${slug}.md`);
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

const MISSING = "_Content for this section is not written yet._";

export function getPhase(slug: string) {
  return phases.find((p) => p.slug === slug);
}

type Step =
  | { type: "lesson"; slug: string; title: string; href: string }
  | { type: "problem"; slug: string; title: string; href: string };

/** Course order: each phase's lessons, then its problems. */
export function courseSteps(): Step[] {
  return phases.flatMap((p) => [
    ...p.lessons.map((l) => ({ type: "lesson" as const, slug: l.slug, title: l.title, href: `/lessons/${l.slug}` })),
    ...p.problems.map((pr) => ({ type: "problem" as const, slug: pr.slug, title: pr.title, href: `/problems/${pr.slug}` })),
  ]);
}

function neighbours(href: string) {
  const steps = courseSteps();
  const i = steps.findIndex((s) => s.href === href);
  return { prev: i > 0 ? steps[i - 1] : null, next: i >= 0 && i < steps.length - 1 ? steps[i + 1] : null };
}

export function getLesson(slug: string):
  | { phase: PhaseMeta; lesson: LessonMeta; body: string; index: number; prev: Step | null; next: Step | null }
  | undefined {
  for (const phase of phases) {
    const index = phase.lessons.findIndex((l) => l.slug === slug);
    if (index >= 0) {
      return {
        phase,
        lesson: phase.lessons[index],
        body: readMarkdown(phase.id, "lessons", slug) ?? MISSING,
        index,
        ...neighbours(`/lessons/${slug}`),
      };
    }
  }
}

export function getProblem(slug: string):
  | {
      phase: PhaseMeta;
      problem: ProblemMeta;
      brief: string;
      solution: string | null;
      prev: Step | null;
      next: Step | null;
    }
  | undefined {
  for (const phase of phases) {
    const problem = phase.problems.find((p) => p.slug === slug);
    if (problem) {
      return {
        phase,
        problem,
        brief: readMarkdown(phase.id, "problems", slug) ?? MISSING,
        solution: readMarkdown(phase.id, "solutions", slug),
        ...neighbours(`/problems/${slug}`),
      };
    }
  }
}

export function lessonTitle(slug: string) {
  for (const p of phases) {
    const l = p.lessons.find((x) => x.slug === slug);
    if (l) return l.title;
  }
  return slug;
}

/** Small, serialisable index of the course, safe to pass to client components. */
export function getCatalog(): Catalog {
  return phases.map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    lessons: p.lessons.map((l) => ({ slug: l.slug, title: l.title, minutes: l.minutes })),
    problems: p.problems.map((pr) => ({
      slug: pr.slug,
      title: pr.title,
      kind: pr.kind,
      needsDiagram: pr.needsDiagram,
      estimatedHours: pr.estimatedHours,
    })),
  }));
}

/** Extract h2 headings for an on-page table of contents. */
export function headingsOf(markdown: string) {
  let inFence = false;
  return markdown
    .split("\n")
    .filter((line) => {
      if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
      return !inFence && /^##\s+/.test(line);
    })
    .map((line) => {
      const text = line.replace(/^##\s+/, "").replace(/[`*_]/g, "").trim();
      return { text, id: slugify(text) };
    });
}
