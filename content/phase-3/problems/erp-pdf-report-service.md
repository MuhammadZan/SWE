## Scenario

Your ERP serves 100,000 users across 3,000 companies. Users generate PDF documents constantly: single invoices and purchase orders (1–3 pages), monthly customer statements, and heavy financial reports such as the general ledger, aged receivables and year-end trial balances (50–2,000 pages). Today PDFs are rendered synchronously inside the API with a headless browser. It works for invoices, but heavy reports time out, crash instances with out-of-memory errors, and on the first business day of each month the whole application becomes unusable.

Leadership wants a dedicated **PDF report generation service** that keeps the main app fast, handles month-end spikes, and never loses a requested report. This is a pure design problem: you produce a design document and an architecture diagram, not running code.

## Scale numbers (use these, state any extra assumptions)

- 100,000 registered users, 25% daily active.
- Small documents (invoices, POs): about 200,000/day, average 120 KB, render time 300 ms.
- Statements: 3,000 companies x average 400 customers, generated as a batch on the 1st of each month, average 250 KB, 800 ms each.
- Heavy reports: about 5,000/day normally, 10x on the first three business days of a month. Average 8 MB, render time 20–180 seconds, peak memory up to 1.5 GB per render.
- Retention: 7 years for invoices and statements (legal requirement), 90 days for ad hoc reports.
- Target: small documents available within 5 seconds p95; heavy reports within 10 minutes p95 even at month end; the main API stays under 200 ms p95 regardless of report load.

## What to produce

### 1. Diagram

Draw the architecture on the whiteboard and export it. It must clearly show request, processing and delivery paths.

### 2. DESIGN.md

Follow the framework from the lessons:

1. **Requirements:** functional, non-functional and explicitly out of scope.
2. **Estimations with working shown:** documents per second (average and month-end peak), worker capacity needed per class of document (use Little's Law), storage per year and over 7 years, egress bandwidth, and a rough monthly cost range for compute and storage.
3. **High-level design:** each component with a one-line purpose, the API contract (request, status and download endpoints with status codes), and the job and report data model.
4. **Deep dives (pick at least three):**
   - Queue topology and priority: how a 2,000-page ledger does not delay a customer waiting for one invoice.
   - Fairness across tenants: how one company requesting 3,000 reports does not starve the others.
   - Statement batch on the 1st: fan-out strategy, how you avoid one giant job, how you track batch completion.
   - Worker sizing and autoscaling: what metric drives scaling (queue depth, oldest job age), memory isolation for heavy renders.
   - Idempotency and deduplication: what happens when a user clicks "Generate" five times, or a worker dies at page 1,900.
   - Storage and delivery: object storage layout, lifecycle rules for retention, signed URLs, caching identical reports.
   - Notification: polling vs websocket vs email for completion.
5. **Trade-offs and failure modes:** at least five, in a table, including what happens if the queue, a worker pool, or object storage is unavailable.
6. **At 10x scale:** what changes first.

## Constraints

- The main API must never render a PDF.
- No single job may run unbounded: define timeouts and what happens when they are hit.
- Generated legal documents must be immutable once issued; regeneration creates a new version.
- Justify every component by a requirement or a number. Remove anything you cannot justify.

## How to verify

- Every number in the doc can be traced to the scale numbers above or a stated assumption, with the arithmetic visible.
- Someone else reading only the diagram can describe the path of one invoice and one 2,000-page report from click to download.
- Your design states explicitly what happens on the first business day of the month at 9:00 a.m., and the worker capacity math shows heavy reports drain within the 10-minute target, or states honestly that they do not and what you would trade.
- Walk your failure-mode table aloud: for each failure, can you say what the user sees?
