# Content authoring guide

Everyone writing course content follows this file. Schema: `lib/types.ts`. Course outline: `software_engineer_roadmap.md`.

## Audience and voice

- A self-taught web developer who already ships SaaS apps and ERPs (TypeScript, Node, React, Postgres) and wants to become a rigorous professional engineer. Skip beginner syntax.
- The roadmap is only a skeleton. The goal is depth: someone should genuinely learn the topic from the app alone, and be able to apply it at work and defend it in an interview.
- Use realistic SaaS/ERP scenarios (invoices, inventory, tenants, subscriptions, ledgers, reports).
- Code in TypeScript unless the topic needs SQL (Postgres), YAML, Dockerfile, shell or config.
- Tone: direct, practical, demystifying jargon. No fluff, no emojis, no hype.
- **Technical accuracy matters more than length.** Prefer current, correct APIs (Node 20+, Postgres 16+, current Redis/BullMQ/Vitest/GitHub Actions syntax). If a claim depends on a version or configuration, say so.

## Folder layout per phase

```
content/phase-N/
  index.ts                  PhaseMeta (lessons, problems, sources)
  lessons/<slug>.md         lesson body
  problems/<slug>.md        problem brief
  solutions/<slug>.md       solution notes (shown only after the learner submits)
```

Slugs are kebab-case and globally unique across all phases. Use plain strings in `.ts` files (no markdown code fences inside TS strings).

## Markdown rules (all .md files)

- No H1. The app renders the title. Use `##` and `###` only.
- GitHub-flavored markdown; tables are fine.
- No `$...$` LaTeX. Write `O(n log n)` in inline code or plain text.
- A line starting with `## ` inside a fenced code block is fine (the app ignores it for the table of contents), but avoid it when easy.

## Lessons (1500–2500 words)

1. `## Why this matters`: a real pain point.
2. Concept sections with multiple code examples (bad → better), ASCII diagrams where they help, and tables for comparisons.
3. `## Common mistakes`
4. `## In the real world`: how it shows up in production codebases and in interviews.
5. `## Try it`: a short hands-on practice.

Metadata: 4–6 `keyTakeaways`. A `quiz` of 5 scenario-based questions (not definitions), each with an explanation. The app shuffles options, so answer position doesn't matter. 2–4 `resources` with real, stable URLs: prefer official docs and well-known sites; never invent deep links you are not sure exist (link a site's root or docs index instead).

## Problems (brief 400–900 words)

The brief covers: scenario, starting point (starter code or data where useful), what to build, constraints, and how to measure and verify.

Metadata:
- 5–8 specific, checkable `requirements` (with concrete numbers where it makes sense)
- 3–5 progressive `hints`
- 4–6 `rubric` items
- 2–4 `stretchGoals`
- 3–6 `repoChecklist` items
- `relatedLessons`
- `designPrompt` is required when `needsDiagram` is true: say what boxes and arrows the diagram must show.

Every problem that involves code must require automated tests for its core logic. The learner should be testing from Phase 1, not only in Phase 4.

## Solution notes (`solutions/<slug>.md`, 700–1400 words)

These unlock after the learner submits. They exist because nobody else reviews the learner's work, so they must help the learner grade themselves honestly. Use these sections:

1. `## What a strong solution looks like`: the shape of a senior-quality answer, in prose.
2. `## Reference approach`: the key design decisions with focused code, SQL or config excerpts. These are the essential parts, not a whole project. For design problems, describe the reference diagram in words or ASCII and give the reasoning plus back-of-envelope numbers.
3. `## Common mistakes`: what weaker submissions get wrong, and why it matters.
4. `## Trade-offs worth discussing`: what an interviewer or tech lead would probe.
5. `## Grade yourself`: a table with three columns (Strong / Acceptable / Needs work) and 4–6 rows, one per key dimension. Each cell is concrete and observable in a repo.
6. `## Going further`: 2–3 follow-ups.

## Before you finish

- Run `cd /Users/pebi/Projects/software-engineer-journel && npx tsc --noEmit 2>&1 | grep content/` and fix any errors in your files.
- Check that every slug has its `.md` file(s) and that every `relatedLessons` slug exists.
