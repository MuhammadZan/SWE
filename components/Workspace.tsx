"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import type { ProblemMeta } from "@/lib/types";
import { checkGitHubRepo, parseGitHubUrl, progress, useProgress } from "@/lib/progress";
import { LazyBoard } from "./board/LazyBoard";
import { Icon } from "./Icon";

type Tab = "brief" | "whiteboard" | "submit" | "solution";

// The active tab lives in the URL hash (#whiteboard, #submit) so it survives reloads and can be linked to.
function subscribeHash(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}
function useTab(): Tab {
  return useSyncExternalStore(
    subscribeHash,
    () => {
      const h = window.location.hash.slice(1);
      return h === "whiteboard" || h === "submit" || h === "solution" ? h : "brief";
    },
    () => "brief",
  );
}

export function Workspace({
  problem,
  related,
  solution,
  children,
}: {
  problem: ProblemMeta;
  related: { slug: string; title: string }[];
  solution: React.ReactNode | null;
  children: React.ReactNode;
}) {
  const tab = useTab();
  const state = useProgress();
  const p = state.problems[problem.slug];
  const checks = p?.checks ?? {};
  const reqDone = problem.requirements.filter((_, i) => checks[`req-${i}`]).length;

  function go(t: Tab) {
    history.replaceState(null, "", t === "brief" ? location.pathname : `#${t}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    if (!p) progress.patchProblem(problem.slug, {}); // marks as started
  }

  const tabs: { id: Tab; label: string; icon: Parameters<typeof Icon>[0]["name"]; badge?: string }[] = [
    { id: "brief", label: "Brief", icon: "book" },
    { id: "whiteboard", label: "Whiteboard", icon: "pen", badge: problem.needsDiagram ? "required" : undefined },
    { id: "submit", label: "Submit", icon: "github", badge: p?.status === "submitted" ? "done" : undefined },
    ...(solution
      ? [
          {
            id: "solution" as const,
            label: "Solution notes",
            icon: "target" as const,
            badge: p?.status === "submitted" || p?.solutionPeeked ? undefined : "locked",
          },
        ]
      : []),
  ];

  return (
    <div>
      <div role="tablist" className="mb-6 flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => go(t.id)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm transition-colors ${
              tab === t.id ? "border-fg font-medium text-fg" : "border-transparent text-muted hover:text-fg"
            }`}
          >
            <Icon name={t.icon} className="size-4" />
            {t.label}
            {t.badge && (
              <span
                className={`rounded-full px-1.5 py-px text-[0.65rem] font-medium ${
                  t.badge === "done"
                    ? "bg-ok-soft text-ok"
                    : t.badge === "locked"
                      ? "bg-surface-2 text-subtle"
                      : "bg-accent-soft text-accent"
                }`}
              >
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "brief" && (
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="min-w-0">
            {problem.needsDiagram && problem.designPrompt && (
              <div className="mb-8 flex max-w-[72ch] gap-3 rounded-xl border border-accent/30 bg-accent-soft p-4 text-sm">
                <Icon name="pen" className="mt-0.5 size-4 shrink-0 text-accent" />
                <div>
                  <div className="font-medium">Your diagram should show</div>
                  <p className="mt-1 text-muted">{problem.designPrompt}</p>
                  <button onClick={() => go("whiteboard")} className="mt-2 font-medium text-accent hover:underline">
                    Open the whiteboard →
                  </button>
                </div>
              </div>
            )}
            {children}
            {problem.stretchGoals.length > 0 && (
              <section className="mt-10 max-w-[72ch]">
                <h2 className="mb-3 text-lg font-semibold tracking-tight">Stretch goals</h2>
                <ul className="space-y-2 text-[0.95rem] text-muted">
                  {problem.stretchGoals.map((g) => (
                    <li key={g} className="flex gap-2.5">
                      <Icon name="plus" className="mt-1 size-3.5 shrink-0 text-subtle" />
                      {g}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
            <Panel title="Acceptance criteria" meta={`${reqDone}/${problem.requirements.length}`}>
              <Checklist slug={problem.slug} prefix="req" items={problem.requirements} checks={checks} />
            </Panel>
            <Hints slug={problem.slug} hints={problem.hints} revealed={p?.hintsRevealed ?? 0} />
            {related.length > 0 && (
              <Panel title="Related lessons">
                <ul className="space-y-1.5">
                  {related.map((r) => (
                    <li key={r.slug}>
                      <Link href={`/lessons/${r.slug}`} className="flex items-center gap-2 text-sm text-muted hover:text-fg">
                        <Icon name="book" className="size-3.5 text-subtle" /> {r.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </aside>
        </div>
      )}

      {tab === "whiteboard" && (
        <div>
          <p className="mb-3 max-w-3xl text-sm text-muted">
            {problem.designPrompt ??
              "Sketch your approach before you code: modules, data flow, where the boundaries sit. Optional for this problem, but it helps."}{" "}
            Autosaves in this browser. Export a PNG and commit it to your repo (for example{" "}
            <code className="font-mono text-xs">docs/architecture.png</code>) before submitting.
          </p>
          <LazyBoard boardId={`problem-${problem.slug}`} title={problem.title} problemSlug={problem.slug} className="h-[75vh]" />
        </div>
      )}

      {tab === "submit" && <Submit problem={problem} hasSolution={!!solution} onOpenSolution={() => go("solution")} />}

      {tab === "solution" && solution && <SolutionNotes problem={problem}>{solution}</SolutionNotes>}
    </div>
  );
}

function Panel({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <h3 className="mb-3 flex items-center justify-between text-xs font-semibold tracking-wider text-subtle uppercase">
        {title}
        {meta && <span className="font-mono font-normal tabular-nums">{meta}</span>}
      </h3>
      {children}
    </section>
  );
}

function Checklist({
  slug,
  prefix,
  items,
  checks,
}: {
  slug: string;
  prefix: string;
  items: string[];
  checks: Record<string, boolean>;
}) {
  return (
    <ul className="space-y-1">
      {items.map((item, i) => {
        const key = `${prefix}-${i}`;
        const on = !!checks[key];
        return (
          <li key={key}>
            <label className="flex cursor-pointer gap-2.5 rounded-md p-1.5 text-sm hover:bg-surface-2">
              <input
                type="checkbox"
                checked={on}
                onChange={() => progress.toggleCheck(slug, key)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
              />
              <span className={on ? "text-muted line-through decoration-subtle" : ""}>{item}</span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

function Hints({ slug, hints, revealed }: { slug: string; hints: string[]; revealed: number }) {
  return (
    <Panel title="Hints" meta={`${revealed}/${hints.length}`}>
      {revealed === 0 && <p className="mb-3 text-sm text-muted">Try for a while first. Hints go from a nudge to nearly the answer.</p>}
      <ol className="space-y-2">
        {hints.slice(0, revealed).map((h, i) => (
          <li key={i} className="flex gap-2.5 rounded-lg bg-surface-2 p-2.5 text-sm">
            <span className="font-mono text-xs text-subtle">{i + 1}</span>
            <span>{h}</span>
          </li>
        ))}
      </ol>
      {revealed < hints.length && (
        <button
          onClick={() => progress.patchProblem(slug, { hintsRevealed: revealed + 1 })}
          className="mt-3 flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
        >
          <Icon name="bulb" className="size-4" /> Reveal hint {revealed + 1}
        </button>
      )}
    </Panel>
  );
}

// Solution notes are a self-honesty gate, not a secret: they unlock after you submit,
// or early (recorded as "peeked") once every hint has been revealed.
function SolutionNotes({ problem, children }: { problem: ProblemMeta; children: React.ReactNode }) {
  const p = useProgress().problems[problem.slug];
  const submitted = p?.status === "submitted";
  const allHints = (p?.hintsRevealed ?? 0) >= problem.hints.length;

  if (!submitted && !p?.solutionPeeked) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-border bg-surface p-8 text-center">
        <Icon name="target" className="mx-auto size-6 text-subtle" />
        <h2 className="mt-3 text-lg font-semibold">Solution notes unlock after you submit</h2>
        <p className="mt-2 text-sm text-pretty text-muted">
          They show what a strong solution looks like, common mistakes, the trade-offs a reviewer would probe, and a
          grading table. Reading them first turns the exercise into reading. Build it, submit, then grade yourself.
        </p>
        {allHints ? (
          <button
            onClick={() => {
              if (confirm("Open the solution notes before submitting? This is recorded on the problem."))
                progress.patchProblem(problem.slug, { solutionPeeked: true });
            }}
            className="mt-5 text-sm text-muted underline underline-offset-2 hover:text-fg"
          >
            I&apos;m truly stuck. Open them anyway
          </button>
        ) : (
          <p className="mt-5 text-xs text-subtle">
            Stuck? Reveal all {problem.hints.length} hints first ({p?.hintsRevealed ?? 0} revealed so far).
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      {!submitted && (
        <p className="mb-6 max-w-[72ch] rounded-lg bg-warn-soft px-3.5 py-2.5 text-sm text-warn">
          You opened these before submitting. Close them, build your own version, and come back to grade it.
        </p>
      )}
      <div className="mb-6 max-w-[72ch] rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm text-muted">
        Grade your repo against the table at the end, then fix the gaps and resubmit. Rewriting after feedback is how
        this turns into skill.
      </div>
      {children}
    </div>
  );
}

function ReviewRequest({ problem, repoUrl }: { problem: ProblemMeta; repoUrl: string }) {
  const [copied, setCopied] = useState(false);
  const text = [
    `Hi! Could you review my solution to "${problem.title}"?`,
    ``,
    `Repo: ${repoUrl}`,
    `Task: ${problem.summary}`,
    ``,
    `What it should do:`,
    ...problem.requirements.map((r) => `- ${r}`),
    ``,
    `I'd especially value blunt feedback on:`,
    ...problem.rubric.slice(0, 4).map((r) => `- ${r}`),
    ``,
    `Even 15 minutes and three comments would help a lot. Thanks!`,
  ].join("\n");

  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <Icon name="github" className="size-4" /> Get a human review
      </h3>
      <p className="mb-3 text-sm text-muted">
        Self-grading has blind spots. Send this to a senior colleague, a mentor, or a developer community&apos;s
        code-review channel. Ask them to comment directly on a pull request if they can.
      </p>
      <pre className="max-h-48 overflow-auto rounded-lg border border-border bg-code p-3 font-mono text-[0.72rem] whitespace-pre-wrap text-muted">
        {text}
      </pre>
      <button
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="mt-3 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-2"
      >
        {copied ? "Copied" : "Copy review request"}
      </button>
    </section>
  );
}

function Submit({
  problem,
  hasSolution,
  onOpenSolution,
}: {
  problem: ProblemMeta;
  hasSolution: boolean;
  onOpenSolution: () => void;
}) {
  const state = useProgress();
  const p = state.problems[problem.slug];
  const latest = p?.submissions.at(-1);
  const checks = p?.checks ?? {};
  const [url, setUrl] = useState(latest?.repoUrl ?? "");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);

  const reqLeft = problem.requirements.filter((_, i) => !checks[`req-${i}`]).length;
  const rubLeft = problem.rubric.filter((_, i) => !checks[`rub-${i}`]).length;
  const repoLeft = problem.repoChecklist.filter((_, i) => !checks[`repo-${i}`]).length;
  const urlValid = !!parseGitHubUrl(url);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await checkGitHubRepo(url);
    setBusy(false);
    if (!res.ok) {
      setMsg({ tone: "err", text: res.reason });
      return;
    }
    progress.submit(problem.slug, { repoUrl: url.trim().replace(/\.git$/, ""), notes: notes.trim(), verified: res.verified });
    setNotes("");
    setMsg(
      res.verified
        ? { tone: "ok", text: `Submitted. Verified public repo ${res.fullName}.` }
        : { tone: "warn", text: res.reason },
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="space-y-6">
        <Panel title="Self-review rubric" meta={`${problem.rubric.length - rubLeft}/${problem.rubric.length}`}>
          <p className="mb-2 text-sm text-muted">Answer each honestly before you submit.</p>
          <Checklist slug={problem.slug} prefix="rub" items={problem.rubric} checks={checks} />
        </Panel>
        <Panel title="Your repo must contain" meta={`${problem.repoChecklist.length - repoLeft}/${problem.repoChecklist.length}`}>
          <Checklist slug={problem.slug} prefix="repo" items={problem.repoChecklist} checks={checks} />
        </Panel>
      </div>

      <div className="space-y-6">
        <form onSubmit={submit} className="rounded-2xl border border-border bg-surface p-5">
          <h3 className="flex items-center gap-2 font-semibold">
            <Icon name="github" className="size-4" /> Submit your solution
          </h3>
          <label className="mt-4 block text-sm font-medium" htmlFor="repo">
            Public GitHub repository
          </label>
          <input
            id="repo"
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/you/modular-erp-core"
            className="mt-1.5 w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          {url && !urlValid && <p className="mt-1.5 text-xs text-danger">Must be a github.com repository link.</p>}
          <label className="mt-4 block text-sm font-medium" htmlFor="notes">
            Notes <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id="notes"
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What you learned, trade-offs you made, what you'd do differently…"
            className="mt-1.5 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          {(reqLeft > 0 || rubLeft > 0 || repoLeft > 0) && (
            <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
              Still unchecked: {[reqLeft && `${reqLeft} criteria`, rubLeft && `${rubLeft} rubric`, repoLeft && `${repoLeft} repo items`]
                .filter(Boolean)
                .join(", ")}
              . You can still submit and iterate.
            </p>
          )}
          <button
            type="submit"
            disabled={!urlValid || busy}
            className="mt-4 w-full rounded-lg bg-fg px-4 py-2.5 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "Checking repository…" : latest ? "Resubmit" : "Submit"}
          </button>
          {msg && (
            <p
              className={`mt-3 text-sm ${msg.tone === "ok" ? "text-ok" : msg.tone === "warn" ? "text-warn" : "text-danger"}`}
              role="status"
            >
              {msg.text}
            </p>
          )}
        </form>

        {latest && hasSolution && (
          <button
            onClick={onOpenSolution}
            className="flex w-full items-center justify-between rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3 text-left text-sm"
          >
            <span>
              <span className="block font-medium">Grade yourself with the solution notes</span>
              <span className="text-muted">Strong / acceptable / needs work, dimension by dimension.</span>
            </span>
            <Icon name="arrowRight" className="size-4 shrink-0 text-accent" />
          </button>
        )}

        {latest && <ReviewRequest problem={problem} repoUrl={latest.repoUrl} />}

        {p && p.submissions.length > 0 && (
          <Panel title="Submission history" meta={String(p.submissions.length)}>
            <ol className="space-y-3">
              {[...p.submissions].reverse().map((s) => (
                <li key={s.submittedAt} className="text-sm">
                  <a
                    href={s.repoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 font-mono text-xs break-all hover:text-accent"
                  >
                    {s.repoUrl.replace("https://github.com/", "")}
                    <Icon name="external" className="size-3 shrink-0" />
                  </a>
                  <div className="mt-0.5 text-xs text-subtle">
                    {new Date(s.submittedAt).toLocaleString()} · {s.verified ? "verified public" : "unverified"}
                  </div>
                  {s.notes && <p className="mt-1 text-muted">{s.notes}</p>}
                </li>
              ))}
            </ol>
          </Panel>
        )}
      </div>
    </div>
  );
}
