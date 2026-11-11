// Shared content schema. Phase content lives in /content/phase-N/.
// Long-form bodies are markdown files; everything else is typed metadata.

export type Resource = {
  label: string;
  url: string;
  kind: "book" | "web" | "video" | "docs" | "interactive";
};

export type QuizQuestion = {
  question: string;
  options: string[]; // 3-4 options
  answer: number; // index into options
  explanation: string; // why the answer is right (and others wrong)
};

export type LessonMeta = {
  slug: string; // kebab-case, globally unique; body at content/phase-N/lessons/<slug>.md
  title: string;
  summary: string; // one sentence
  minutes: number; // estimated reading + practice time
  keyTakeaways: string[]; // 4-6 bullets
  quiz: QuizQuestion[]; // 4-6 questions
  resources: Resource[]; // further reading for this lesson
};

export type ProblemMeta = {
  slug: string; // kebab-case, globally unique; brief at content/phase-N/problems/<slug>.md
  title: string;
  kind: "exercise" | "capstone" | "design";
  // design = a pure system-design/architecture problem solved mainly by drawing + writeup
  summary: string; // one sentence
  estimatedHours: number;
  needsDiagram: boolean; // true => the in-app whiteboard is shown prominently
  designPrompt?: string; // required when needsDiagram: what the diagram must show
  requirements: string[]; // acceptance criteria, each checkable by the learner
  hints: string[]; // progressive, from gentle nudge to near-solution (3-5)
  rubric: string[]; // self-review questions before submitting
  stretchGoals: string[];
  repoChecklist: string[]; // what the public GitHub repo must contain
  relatedLessons: string[]; // lesson slugs
};

export type PhaseMeta = {
  id: number; // 1-4
  slug: string; // e.g. "architecture"
  title: string;
  tagline: string; // the short parenthetical from the roadmap
  objective: string;
  overview: string; // 2-3 short paragraphs (plain text, \n\n separated)
  lessons: LessonMeta[]; // in recommended order
  problems: ProblemMeta[]; // exercises first, then design problems, capstone last
  sources: Resource[];
};
