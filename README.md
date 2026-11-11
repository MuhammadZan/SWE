# Engineer Journal

A self-paced learning app for `software_engineer_roadmap.md`: four phases (architecture, performance, system design, testing & infrastructure), each with in-depth lessons, quizzes, hands-on problems, a built-in whiteboard, and GitHub repo submissions.

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
| Phase metadata, quizzes, criteria, hints | `content/phase-N/index.ts` (schema in `lib/types.ts`) |
| Progress store (localStorage) | `lib/progress.ts` |
| Whiteboard (Excalidraw + system-design stencils) | `components/board/` |

- **Progress** is stored in your browser only. Use **Progress → Download backup** to save or move it (includes whiteboards).
- **Submissions** take a public `https://github.com/owner/repo` link. The app checks the GitHub API to confirm the repo exists and is public; if GitHub is rate-limited or unreachable, the link is saved as unverified.
- **Whiteboard**: each problem has its own board, and `/whiteboard` holds free boards. Export a PNG and commit it to your repo for design problems.

## Adding or editing content

Edit the markdown files directly. To add a lesson or problem, add its entry to the phase's `index.ts` and create the matching `.md` file with the same slug.
