# Engineer Journal

A self-paced learning app built from `software_engineer_roadmap.md`, extended to six phases:

0. Engineering Foundations (networking, API design, auth, application security, Git/code review/design docs)
1. Code Organization & Scalable Architectures
2. Code Performance & Resource Scaling (plus an interview-patterns track)
3. System Design & Traffic Scaling
4. Automated Testing & Infrastructure
5. Databases in Production (modeling, transactions, bottleneck diagnosis, scaling strategies, migrations, recovery, security, monitoring)

Each phase has in-depth lessons, quizzes, hands-on problems, a built-in whiteboard, GitHub repo submissions, and solution notes that unlock after you submit.

## Run it

```bash
npm install
npm run dev     # http://localhost:3000
```

## What's inside

| Area | Where |
| --- | --- |
| Lessons (markdown) | `content/phase-N/lessons/<slug>.md` |
| Problem briefs (markdown) | `content/phase-N/problems/<slug>.md` |
| Solution notes (unlock after submitting) | `content/phase-N/solutions/<slug>.md` |
| Writing standards for all content | `content/AUTHORING.md` |
| Phase metadata, quizzes, criteria, hints | `content/phase-N/index.ts` (schema in `lib/types.ts`) |
| Progress store (localStorage) | `lib/progress.ts` |
| Whiteboard (Excalidraw + system-design stencils) | `components/board/` |

- **Progress** is stored in your browser only. Use **Progress → Download backup** to save or move it (includes whiteboards).
- **Submissions** take a public `https://github.com/owner/repo` link. The app checks the GitHub API to confirm the repo exists and is public; if GitHub is rate-limited or unreachable, the link is saved as unverified.
- **Whiteboard**: each problem has its own board, and `/whiteboard` holds free boards. Export a PNG and commit it to your repo for design problems.

## Adding or editing content

Edit the markdown files directly. To add a lesson or problem, add its entry to the phase's `index.ts` and create the matching `.md` file with the same slug.
