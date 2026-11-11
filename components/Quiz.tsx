"use client";

import { useState } from "react";
import type { QuizQuestion } from "@/lib/types";
import { progress, useProgress } from "@/lib/progress";
import { Icon } from "./Icon";

// Deterministic shuffle (same order on server and client, stable across visits)
// so the correct answer isn't always in the same slot.
function seeded(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function shuffleQuestion(q: QuizQuestion, seed: string): QuizQuestion {
  const rand = seeded(seed);
  const order = q.options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { ...q, options: order.map((i) => q.options[i]), answer: order.indexOf(q.answer) };
}

export function Quiz({ slug, questions: raw }: { slug: string; questions: QuizQuestion[] }) {
  const [questions] = useState(() => raw.map((q, i) => shuffleQuestion(q, `${slug}:${i}`)));
  const [picked, setPicked] = useState<(number | null)[]>(() => questions.map(() => null));
  const [checked, setChecked] = useState(false);
  const best = useProgress().quizzes[slug];

  const answered = picked.filter((p) => p !== null).length;
  const score = picked.filter((p, i) => p === questions[i].answer).length;

  function check() {
    setChecked(true);
    progress.recordQuiz(slug, score, questions.length);
  }

  function retry() {
    setPicked(questions.map(() => null));
    setChecked(false);
  }

  return (
    <section id="quiz" className="mt-12 max-w-[72ch] scroll-mt-8">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="text-xl font-semibold tracking-tight">Check your understanding</h2>
        {best && !checked && (
          <span className="font-mono text-xs text-muted">
            last score {best.score}/{best.total}
          </span>
        )}
      </div>

      <ol className="space-y-5">
        {questions.map((q, qi) => (
          <li key={qi} className="rounded-2xl border border-border bg-surface p-5">
            <p className="font-medium">
              <span className="mr-2 font-mono text-xs text-subtle">Q{qi + 1}</span>
              {q.question}
            </p>
            <div className="mt-3 grid gap-2">
              {q.options.map((opt, oi) => {
                const isPicked = picked[qi] === oi;
                const isRight = oi === q.answer;
                let style = "border-border hover:border-border-strong hover:bg-surface-2";
                if (!checked && isPicked) style = "border-fg bg-surface-2";
                if (checked && isRight) style = "border-ok bg-ok-soft";
                if (checked && isPicked && !isRight) style = "border-danger bg-danger/10";
                return (
                  <button
                    key={oi}
                    disabled={checked}
                    onClick={() => setPicked((p) => p.map((v, i) => (i === qi ? oi : v)))}
                    className={`flex items-start gap-3 rounded-lg border px-3.5 py-2.5 text-left text-sm transition-colors disabled:cursor-default ${style}`}
                  >
                    <span
                      className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border ${
                        isPicked ? "border-fg" : "border-border-strong"
                      }`}
                    >
                      {isPicked && <span className="size-2 rounded-full bg-fg" />}
                    </span>
                    <span>{opt}</span>
                  </button>
                );
              })}
            </div>
            {checked && (
              <div
                className={`mt-3 rounded-lg px-3.5 py-2.5 text-sm ${
                  picked[qi] === q.answer ? "bg-ok-soft" : "bg-surface-2"
                }`}
              >
                <span className="font-medium">{picked[qi] === q.answer ? "Correct. " : "Not quite. "}</span>
                <span className="text-muted">{q.explanation}</span>
              </div>
            )}
          </li>
        ))}
      </ol>

      <div className="mt-5 flex items-center gap-4">
        {!checked ? (
          <button
            onClick={check}
            disabled={answered < questions.length}
            className="rounded-lg bg-fg px-4 py-2.5 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Check answers
          </button>
        ) : (
          <>
            <span className="inline-flex items-center gap-2 text-sm font-medium">
              <Icon name="target" className="size-4 text-accent" />
              {score}/{questions.length} correct
            </span>
            <button onClick={retry} className="text-sm text-muted underline-offset-2 hover:text-fg hover:underline">
              Try again
            </button>
          </>
        )}
        {!checked && (
          <span className="text-xs text-muted">
            {answered}/{questions.length} answered
          </span>
        )}
      </div>
    </section>
  );
}
