import type { PhaseMeta } from "@/lib/types";

export const phase: PhaseMeta = {
  id: 4,
  slug: "testing-infrastructure",
  title: "Automated Testing & Infrastructure",
  tagline: "CI/CD Pipelines, Docker, Enterprise DevOps",
  objective:
    "Eliminate manual, point-and-click deployment strategies. Secure code stability through automated verification pipelines.",
  overview:
    "Shipping a SaaS app is easy; shipping it every day without breaking invoices, dropping requests, or relying on one person's laptop is the professional skill. This phase replaces manual checking and SSH deploys with a chain of automated evidence: unit tests that pin down money math, integration tests against a real Postgres, an immutable Docker image, and a GitHub Actions pipeline that gates every merge.\n\nYou then take that image from the registry to production with zero downtime: rolling, blue-green and canary strategies, readiness checks, expand/contract database migrations, and one-command rollbacks. Finally you learn what to watch after a deploy so a healthy-but-wrong release is caught in minutes, not reported by a customer weeks later.\n\nBy the end you will have a public repository whose pipeline tests, builds, deploys and verifies every commit on main, plus a written design for a team-scale delivery process.",
  lessons: [
    {
      slug: "unit-testing-business-logic",
      title: "Unit Testing Business Logic",
      summary:
        "Write fast, readable Vitest unit tests for money math using AAA, test doubles, edge-case tables and a red-green-refactor TDD loop.",
      minutes: 55,
      keyTakeaways: [
        "A unit test checks one behaviour without network, filesystem, clock, randomness or database; push those to injected dependencies.",
        "Compute money in integer cents and basis points, round once with a documented rule, and assert exact integers.",
        "Bugs live at boundaries: test zero, one, thresholds plus and minus one, huge values, and invalid runtime input, always asserting the specific error.",
        "Stubs return canned data, fakes are working simplified implementations, mocks and spies assert interactions; prefer asserting on state.",
        "TDD's red step proves a test can fail; the green step adds the least code; refactor is safe because tests stay green.",
      ],
      quiz: [
        {
          question:
            "A discount function stacks a 10% and a 20% coupon as 0.1 + 0.2 and returns 0.30000000000000004, so a test using toBe(0.3) fails. What is the best fix?",
          options: [
            "Represent amounts as integer cents and percentages as basis points, rounding once at a defined step",
            "Change the assertion to toBeCloseTo(0.3)",
            "Wrap the result in Number(result.toFixed(2)) inside the test",
            "Use parseFloat on the inputs before calculating",
          ],
          answer: 0,
          explanation:
            "Floating-point error is a property of the representation, not the test. Integer cents and basis points make results exact, so tests can assert exact values. toBeCloseTo and toFixed hide the problem and can still produce off-by-one-cent invoices in aggregate.",
        },
        {
          question:
            "An InvoiceService needs a tax-rate lookup that calls an external API. In a unit test you replace it with an object whose rateBpFor() always resolves to 1900. What kind of test double is that?",
          options: [
            "A fake",
            "A mock with strict expectations",
            "A stub",
            "A dummy",
          ],
          answer: 2,
          explanation:
            "A stub returns canned answers so the unit can run; you assert on the unit's output. A fake is a working simplified implementation (like an in-memory repository), a mock fails the test if expected interactions do not happen, and a dummy is never used.",
        },
        {
          question:
            "Your validation test is written as expect(() => applyDiscount(input)).toThrow(). After a refactor, the function crashes with 'Cannot read properties of undefined' before reaching validation, yet the test still passes. What should you change?",
          options: [
            "Nothing; the function threw, which is what was expected",
            "Wrap the call in try/catch and assert that catch was reached",
            "Delete the test because validation is covered by TypeScript types",
            "Assert the specific error class or message, such as toThrow(RangeError) or toThrow(/couponBp/)",
          ],
          answer: 3,
          explanation:
            "A bare toThrow() passes for any error, including unrelated crashes. Asserting the error class or message proves the right rule rejected the input. TypeScript types do not exist at runtime, so input from JSON bodies must still be validated and tested.",
        },
        {
          question:
            "A pricing rule gives 10% off seats 11-50. Which set of seat counts gives the best boundary coverage?",
          options: [
            "1, 25, 100",
            "10, 11, 50, 51, plus 0 and an invalid value like 2.5",
            "11 and 50 only",
            "A random number between 1 and 100 on every run",
          ],
          answer: 1,
          explanation:
            "Off-by-one errors happen at the edges of each tier, so test both sides of each threshold, plus zero and invalid input. Random inputs make failures non-reproducible unless you use a seeded property-based testing tool deliberately.",
        },
        {
          question:
            "Following TDD, you write a test for prorate() and run it before writing any implementation. It fails with 'prorate is not defined'. What is the correct next step?",
          options: [
            "Write the full proration algorithm including all edge cases",
            "Skip to refactoring since the test has been written",
            "Write the minimum code that makes this test pass, then add the next failing test",
            "Delete the test; tests should be written after the code",
          ],
          answer: 2,
          explanation:
            "Red-green-refactor: after seeing red, write the smallest change to go green, then let the next failing test force more behaviour. Writing everything at once loses the guarantee that each piece of logic is demanded and covered by a test.",
        },
      ],
      resources: [
        { label: "Vitest documentation", url: "https://vitest.dev/guide/", kind: "docs" },
        { label: "Martin Fowler: Mocks Aren't Stubs", url: "https://martinfowler.com/articles/mocksArentStubs.html", kind: "web" },
        { label: "Martin Fowler: Unit Test", url: "https://martinfowler.com/bliki/UnitTest.html", kind: "web" },
        { label: "Martin Fowler: Test Driven Development", url: "https://martinfowler.com/bliki/TestDrivenDevelopment.html", kind: "web" },
      ],
    },
    {
      slug: "integration-testing-postgres",
      title: "Integration Testing with a Real Postgres",
      summary:
        "Test repositories and HTTP routes against a real Postgres using Testcontainers or docker compose, with factories, isolation strategies and in-process requests.",
      minutes: 60,
      keyTakeaways: [
        "Integration tests catch what unit tests cannot: SQL errors, constraints, migrations and HTTP wiring.",
        "Test against the same database engine and major version as production; SQLite is not Postgres.",
        "Use small factories with random unique values instead of a shared seed file.",
        "Pick an isolation strategy (transaction rollback, truncate, or database per worker) and enforce it so tests never depend on order.",
        "Keep owned infrastructure real (Postgres, Redis) and replace third-party APIs with stubs or fakes.",
        "Choose test levels by where bugs come from: unit for rules, integration for queries and routes, a few E2E tests for money-making flows.",
      ],
      quiz: [
        {
          question:
            "All unit tests pass with an in-memory InvoiceRepository, but production fails with 'duplicate key value violates unique constraint invoices_number_key'. Which test would most directly have caught this?",
          options: [
            "A unit test with a mocked repository asserting save() was called once",
            "An end-to-end browser test of the invoice page",
            "A snapshot test of the invoice JSON",
            "An integration test against real Postgres that inserts two invoices with the same number and expects error code 23505",
          ],
          answer: 3,
          explanation:
            "The bug lives in the database constraint, which only exists in the real database. A mocked or in-memory repository will never enforce it.",
        },
        {
          question:
            "Your integration tests pass when run one file at a time but fail randomly when the full suite runs. Each test inserts customers into a shared database and asserts the total count of customers. What is the root cause?",
          options: [
            "Tests share mutable state with no isolation, and assertions depend on data created by other tests",
            "Postgres is too slow for tests",
            "Vitest does not support databases",
            "The tests need longer timeouts",
          ],
          answer: 0,
          explanation:
            "Order-dependent failures come from leaking state. Isolate with transaction rollback, truncation per test, or a database per worker, and assert only on data the test itself created.",
        },
        {
          question:
            "A team proposes using SQLite in-memory for integration tests 'because it is faster', while production runs Postgres 16 with jsonb columns and partial indexes. What is the main problem?",
          options: [
            "SQLite cannot run in CI",
            "Tests now verify behaviour of a different engine with different types, locking and SQL dialect, so they can pass while production queries fail",
            "SQLite is slower than Postgres",
            "There is no problem as long as the ORM is the same",
          ],
          answer: 1,
          explanation:
            "Integration tests are valuable precisely because they use the real dependency. Different engines differ in types, constraints and dialect; a containerised Postgres 16 costs a few seconds and removes the mismatch.",
        },
        {
          question:
            "You use transaction-per-test isolation. A test inserts a duplicate invoice expecting a unique violation, then tries to read data in the same test, and gets 'current transaction is aborted'. Why?",
          options: [
            "The pool ran out of connections",
            "Vitest closed the connection after the first assertion",
            "In Postgres, after an error inside a transaction, all further statements fail until rollback; put the expected failure last or use a savepoint",
            "Unique violations corrupt the table",
          ],
          answer: 2,
          explanation:
            "Postgres marks the transaction as aborted after any error. Wrapping the failing statement in a savepoint and rolling back to it, or ordering it last, keeps the rest of the test working.",
        },
        {
          question:
            "Which test suite balance best fits a typical SaaS billing backend?",
          options: [
            "Dense unit tests on pricing and tax rules, integration tests for every repository and route, and a handful of E2E tests for sign-up, upgrade and payment",
            "Only end-to-end browser tests, since they cover everything",
            "Only unit tests with every dependency mocked, to keep the suite fast",
            "Integration tests only; unit tests are redundant",
          ],
          answer: 0,
          explanation:
            "Match test level to where bugs hide: rules at unit level, SQL and wiring at integration level, critical revenue flows at E2E level. All-E2E suites are slow and flaky; all-mocked suites miss integration bugs.",
        },
      ],
      resources: [
        { label: "Testcontainers for Node.js: Postgres module", url: "https://testcontainers.com/modules/postgresql/", kind: "docs" },
        { label: "Martin Fowler: The Practical Test Pyramid", url: "https://martinfowler.com/articles/practical-test-pyramid.html", kind: "web" },
        { label: "Martin Fowler: Integration Test", url: "https://martinfowler.com/bliki/IntegrationTest.html", kind: "web" },
        { label: "Vitest: global setup and configuration", url: "https://vitest.dev/config/", kind: "docs" },
      ],
    },
    {
      slug: "docker-fundamentals",
      title: "Docker Fundamentals for Node Services",
      summary:
        "Package a Node/TypeScript service as a small, secure, cache-friendly image with multi-stage builds, healthchecks and runtime config, and run a local stack with compose.",
      minutes: 60,
      keyTakeaways: [
        "An image is an immutable layered template; a container is a running instance with an ephemeral writable layer.",
        "Order Dockerfile instructions from least to most frequently changing so dependency installs stay cached.",
        "Multi-stage builds keep compilers, dev dependencies and source out of the runtime image.",
        "Use .dockerignore as a security control, run as a non-root user, and start Node with exec-form CMD so it receives SIGTERM.",
        "Build one image and configure it per environment at runtime; validate config at startup and never bake secrets into layers.",
        "In compose, services reach each other by service name, and depends_on with service_healthy waits for real readiness.",
      ],
      quiz: [
        {
          question:
            "Every Docker build takes 4 minutes because npm ci reruns even when only a .ts file changed. The Dockerfile does COPY . . then RUN npm ci. What fixes it?",
          options: [
            "Switch from npm ci to npm install",
            "Add --no-cache to docker build",
            "Copy package.json and package-lock.json first, run npm ci, then copy the source",
            "Use a larger base image with packages preinstalled",
          ],
          answer: 2,
          explanation:
            "A changed layer invalidates every layer after it. Copying only the manifest files before installing lets Docker reuse the install layer until the lockfile changes.",
        },
        {
          question:
            "During deploys, in-flight requests are cut off and the container always takes 10 seconds to stop. The Dockerfile ends with CMD npm start. What is the most likely cause?",
          options: [
            "The image is too large",
            "Node is not PID 1 and does not receive SIGTERM, so Docker waits the grace period and then sends SIGKILL",
            "The healthcheck interval is too long",
            "Alpine images do not support signals",
          ],
          answer: 1,
          explanation:
            "Shell-form CMD and npm start put another process in front of Node that may not forward signals. Use exec form CMD [\"node\", \"dist/server.js\"] and handle SIGTERM for graceful shutdown.",
        },
        {
          question:
            "A developer's .env file with a live Stripe key was found inside a published image, even though a later RUN rm .env removed it. Why is it still exposed?",
          options: [
            "Each instruction creates a layer; the layer created by COPY still contains the file and can be extracted from the image",
            "rm does not work inside Docker builds",
            "Docker automatically backs up deleted files",
            "The registry restored it",
          ],
          answer: 0,
          explanation:
            "Layers are additive. Deleting a file in a later layer hides it but does not remove it from the earlier layer. Exclude secrets with .dockerignore and pass them at runtime.",
        },
        {
          question:
            "In compose, the api service's DATABASE_URL is postgres://app:app@localhost:5432/app and connections are refused, although the db service is running. What is wrong?",
          options: [
            "Postgres needs a restart",
            "Port 5432 must be changed to 5433",
            "Compose does not support Postgres",
            "Inside the api container, localhost is the api container itself; use the service name db as the host",
          ],
          answer: 3,
          explanation:
            "Each container has its own network namespace. Compose provides DNS for service names on the shared network, so the host should be db.",
        },
        {
          question:
            "You want staging and production to use different databases and log levels. What is the recommended approach?",
          options: [
            "Build separate images with different ENV values for each environment",
            "Build one image and inject environment-specific configuration at runtime, validating it at startup",
            "Edit config files inside the running container after it starts",
            "Commit a .env.production file into the image",
          ],
          answer: 1,
          explanation:
            "One image promoted across environments guarantees production runs exactly what was tested. Runtime config via environment variables or a secret store keeps the image environment-agnostic.",
        },
      ],
      resources: [
        { label: "Docker Curriculum", url: "https://docker-curriculum.com", kind: "interactive" },
        { label: "Docker docs: Multi-stage builds", url: "https://docs.docker.com/build/building/multi-stage/", kind: "docs" },
        { label: "Docker docs: Building best practices", url: "https://docs.docker.com/build/building/best-practices/", kind: "docs" },
        { label: "Docker docs: Compose file reference", url: "https://docs.docker.com/reference/compose-file/", kind: "docs" },
      ],
    },
    {
      slug: "ci-github-actions",
      title: "CI Pipelines with GitHub Actions",
      summary:
        "Build a pull-request pipeline with parallel lint, format, typecheck, unit and integration jobs, cached dependencies, a Postgres service, safe secrets and required checks.",
      minutes: 55,
      keyTakeaways: [
        "A workflow contains jobs that run in parallel on fresh runners; steps inside a job share a filesystem; needs creates ordering.",
        "Format, lint, typecheck, unit, integration and build each catch different failures; run them in check mode, never auto-fix in CI.",
        "Cache dependencies keyed on the lockfile and use npm ci so CI installs exactly what is locked.",
        "Service containers with health options give integration tests a real Postgres reachable on localhost.",
        "Secrets are masked but not magic: least-privilege GITHUB_TOKEN, environment-scoped secrets, and no secrets for fork PRs.",
        "Branch protection with required checks is what turns CI from a suggestion into a gate.",
      ],
      quiz: [
        {
          question:
            "CI is green on every PR, yet broken code reached main twice last month. Investigation shows the PRs were merged while checks were still running or failing. What is missing?",
          options: [
            "Branch protection requiring the CI status checks to pass before merging",
            "More unit tests",
            "A faster runner",
            "A nightly scheduled workflow",
          ],
          answer: 0,
          explanation:
            "Without required status checks, the merge button ignores CI. A ruleset or branch protection rule on main makes the checks a hard gate.",
        },
        {
          question:
            "Your integration job fails intermittently with 'connection refused' on the first test. The workflow starts a postgres service with no options. What is the best fix?",
          options: [
            "Add sleep 30 before the tests",
            "Retry the whole workflow automatically",
            "Add health options (--health-cmd pg_isready ...) to the service so the runner waits until Postgres is ready",
            "Move Postgres to a separate job",
          ],
          answer: 2,
          explanation:
            "With health options, GitHub Actions waits for the service to report healthy before running steps. Fixed sleeps are either too slow or too short.",
        },
        {
          question:
            "Your app builds with esbuild and deploys fine, but a production crash reveals a type error that was in the code for weeks. Which CI gate would have caught it?",
          options: [
            "prettier --check",
            "tsc --noEmit",
            "npm audit",
            "docker build",
          ],
          answer: 1,
          explanation:
            "Many bundlers strip types without checking them. A separate typecheck job running tsc --noEmit is required to enforce type safety.",
        },
        {
          question:
            "An open-source contributor opens a PR from a fork, and the integration job that needs secrets.STRIPE_TEST_KEY fails with an empty key. What is happening?",
          options: [
            "The secret was deleted",
            "Secrets only work on Windows runners",
            "The secret name is case-sensitive and must be lowercase",
            "GitHub does not pass repository secrets to workflows triggered by pull requests from forks, to prevent exfiltration",
          ],
          answer: 3,
          explanation:
            "Fork PRs run untrusted code, so secrets are withheld. Design core required checks to need no secrets, and run secret-dependent tests after merge or in a protected context.",
        },
        {
          question:
            "You renamed a job from 'test' to 'Unit tests'. Now every PR shows 'Expected - waiting for status to be reported' and cannot be merged. Why?",
          options: [
            "GitHub Actions is down",
            "Renaming a job requires deleting the workflow history",
            "Branch protection still requires a check named 'test', which no longer reports; update the required checks to the new job name",
            "Job names cannot contain spaces",
          ],
          answer: 2,
          explanation:
            "Required checks are matched by name. When a job is renamed, the old required check never arrives, so update the rule to require the new name.",
        },
      ],
      resources: [
        { label: "GitHub Actions documentation", url: "https://docs.github.com/actions", kind: "docs" },
        { label: "GitHub Docs: Creating PostgreSQL service containers", url: "https://docs.github.com/en/actions/use-cases-and-examples/using-containerized-services/creating-postgresql-service-containers", kind: "docs" },
        { label: "GitHub Docs: Security hardening for GitHub Actions", url: "https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions", kind: "docs" },
        { label: "Martin Fowler: Continuous Integration", url: "https://martinfowler.com/articles/continuousIntegration.html", kind: "web" },
      ],
    },
    {
      slug: "cd-zero-downtime-deploys",
      title: "Continuous Delivery and Zero-Downtime Deploys",
      summary:
        "Push immutable images to GHCR, promote them through gated environments, deploy with rolling, blue-green or canary strategies, migrate safely with expand/contract, and roll back on demand.",
      minutes: 65,
      keyTakeaways: [
        "Build once, tag with the git SHA, and promote the same image from staging to production; never rebuild per environment.",
        "GitHub environments add approval gates, branch restrictions and scoped secrets; concurrency prevents overlapping or cancelled production deploys.",
        "Rolling, blue-green and canary all avoid downtime but trade off capacity, rollback speed and complexity.",
        "Readiness checks and graceful SIGTERM handling are what actually make a rollout zero-downtime.",
        "During any rollout old and new code share the database, so schema changes must be expand/contract and run before the code rollout.",
        "A rollback is a redeploy of a previous immutable tag; practise it before you need it.",
      ],
      quiz: [
        {
          question:
            "A release renames invoices.customer_id to account_id in a single migration, run just before a rolling deploy. Errors spike for 3 minutes. Why?",
          options: [
            "Rolling deploys are incompatible with Postgres",
            "Old instances still running during the rollout query customer_id, which no longer exists; the change should be expand/contract across several releases",
            "The migration was too slow",
            "The new code had a syntax error",
          ],
          answer: 1,
          explanation:
            "During a rollout both versions serve traffic against one schema. Add the new column, dual-write, backfill, switch reads, stop writing the old column, and only then drop it.",
        },
        {
          question:
            "Your team deploys with docker pull myapp:latest. After a bad release you need to roll back, but nobody knows which version was running before. What practice prevents this?",
          options: [
            "Pull latest twice",
            "Keep the old server running forever",
            "Use a larger registry",
            "Tag every image immutably with the git SHA, deploy by that tag, and record deploy history",
          ],
          answer: 3,
          explanation:
            "Moving tags are ambiguous. Immutable SHA tags make every deploy and rollback a precise, repeatable operation.",
        },
        {
          question:
            "You want to expose a risky pricing-engine change to only about 5% of traffic and automatically abort if the error rate rises. Which strategy fits?",
          options: [
            "Recreate",
            "Blue-green",
            "Canary",
            "Manual SSH deploy",
          ],
          answer: 2,
          explanation:
            "Canary routes a small share of traffic to the new version and promotes or aborts based on metrics. Blue-green switches all traffic at once.",
        },
        {
          question:
            "A rolling deploy marks new instances as ready immediately because /readyz always returns 200, even before the DB pool connects. What is the consequence?",
          options: [
            "The load balancer sends traffic to instances that cannot serve it yet, causing errors during every rollout",
            "No consequence; readiness is optional",
            "Deploys become slower",
            "Old instances never stop",
          ],
          answer: 0,
          explanation:
            "Readiness is the signal that gates traffic. It must reflect whether dependencies are reachable, otherwise zero-downtime strategies still produce errors.",
        },
        {
          question:
            "A developer pushes to main while a production deploy is running. The workflow uses concurrency with cancel-in-progress: true for the production job. What is the risk?",
          options: [
            "None; the newer commit is better",
            "The in-progress deploy can be cancelled halfway, leaving production in a mixed or partially switched state",
            "The newer commit is skipped",
            "GitHub charges double minutes",
          ],
          answer: 1,
          explanation:
            "For deploy jobs, use a concurrency group with cancel-in-progress: false so deploys queue instead of being interrupted midway.",
        },
      ],
      resources: [
        { label: "GitHub Docs: Publishing Docker images", url: "https://docs.github.com/en/actions/use-cases-and-examples/publishing-packages/publishing-docker-images", kind: "docs" },
        { label: "GitHub Docs: Managing environments for deployment", url: "https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-deployments/managing-environments-for-deployment", kind: "docs" },
        { label: "Martin Fowler: Blue Green Deployment", url: "https://martinfowler.com/bliki/BlueGreenDeployment.html", kind: "web" },
        { label: "Martin Fowler: Parallel Change (expand/contract)", url: "https://martinfowler.com/bliki/ParallelChange.html", kind: "web" },
      ],
    },
    {
      slug: "observability-after-deploy",
      title: "Observability for Shipped Software",
      summary:
        "Instrument a service with structured logs, RED and business metrics, health and version endpoints, and symptom-based alerts, and know exactly what to check after a deploy.",
      minutes: 50,
      keyTakeaways: [
        "Logs explain individual events, metrics show trends and drive alerts, traces show where time goes across services.",
        "Log JSON to stdout with level, request ID, tenant ID and release version; redact secrets and personal data.",
        "Track rate, errors and duration per route template using percentiles, plus business metrics that reveal healthy-but-wrong releases.",
        "Avoid high-cardinality labels such as user IDs or raw URLs in metrics.",
        "Alert on user-facing symptoms with a runbook, not on every error line or CPU spike.",
        "A deploy is not done until /version, readiness, smoke tests and per-version error and latency comparisons look good.",
      ],
      quiz: [
        {
          question:
            "After a deploy, all health checks are green, but invoices for German customers are created without VAT. Which signal would most likely have caught this within minutes?",
          options: [
            "CPU utilisation alert",
            "Liveness probe",
            "Disk usage alert",
            "A business metric such as invoices with zero tax for taxable countries, compared against its baseline",
          ],
          answer: 3,
          explanation:
            "Health checks only prove the process works, not that it is correct. Business metrics catch logic regressions that are invisible to infrastructure signals.",
        },
        {
          question:
            "Average latency for POST /invoices is 240 ms and looks fine, but customers complain about slowness. What should you look at?",
          options: [
            "p95 and p99 latency, since averages hide a slow tail",
            "The minimum latency",
            "The number of log lines",
            "Memory usage",
          ],
          answer: 0,
          explanation:
            "A small fraction of very slow requests barely moves the average. Percentiles reveal the experience of the slowest users.",
        },
        {
          question:
            "A developer adds a metric label invoiceId to http_request_duration_seconds. A week later the metrics backend is slow and expensive. Why?",
          options: [
            "Histograms are always expensive",
            "Metrics should never have labels",
            "Each unique label value creates a new time series; an ID label creates unbounded cardinality",
            "The label name is too long",
          ],
          answer: 2,
          explanation:
            "Labels must have a small, bounded set of values such as route template, method and status. Per-entity detail belongs in logs or traces.",
        },
        {
          question:
            "Your on-call channel receives about 200 alerts a day for individual error log lines, and the team has muted it. What is the better alerting approach?",
          options: [
            "Add more alerts so nothing is missed",
            "Alert on user-facing symptoms such as sustained 5xx rate or latency over thresholds, each with a runbook",
            "Disable alerting and rely on customer reports",
            "Send alerts by email instead",
          ],
          answer: 1,
          explanation:
            "Alerts must be actionable and rare enough to be trusted. Symptom-based thresholds over a time window filter noise and point to real user impact.",
        },
        {
          question:
            "The pipeline reports a successful deploy, but users still see old behaviour. Which automated post-deploy check would detect this?",
          options: [
            "Asserting that /version on the public URL returns the image tag that was just deployed",
            "Checking that /healthz returns 200",
            "Re-running unit tests",
            "Checking that the Docker image exists in the registry",
          ],
          answer: 0,
          explanation:
            "A healthy old container still passes health checks. A version endpoint fed by the build's APP_VERSION proves the new release is actually serving traffic.",
        },
      ],
      resources: [
        { label: "Docker docs: Logging drivers and container logs", url: "https://docs.docker.com/engine/logging/", kind: "docs" },
        { label: "Martin Fowler: Domain-Oriented Observability", url: "https://martinfowler.com/articles/domain-oriented-observability.html", kind: "web" },
        { label: "OpenTelemetry: JavaScript getting started", url: "https://opentelemetry.io/docs/languages/js/getting-started/nodejs/", kind: "docs" },
      ],
    },
  ],
  problems: [
    {
      slug: "unit-assertions",
      title: "The Unit Assertions",
      kind: "exercise",
      summary:
        "Implement a graduated seat-tier subscription quote with annual and coupon discounts and EU VAT, and lock it down with exact-cent Vitest tests for valid, rounding and malicious inputs.",
      estimatedHours: 5,
      needsDiagram: false,
      requirements: [
        "quote() computes all amounts in integer cents with a single documented rounding rule.",
        "Graduated volume tiers are tested at 10, 11, 50 and 51 seats with exact expected cents.",
        "Annual plus coupon discount is tested to cap at 40% of the post-volume subtotal.",
        "Each VAT country (DE, FR, NL, US) and EU reverse charge are covered by tests.",
        "Invalid seats (0, negative, fractional, NaN, Infinity, huge), invalid coupons and unknown plan or country from JSON.parse each throw a specific custom error with the offending field.",
        "No test uses a bare toThrow(); every validation assertion specifies the error class or field.",
        "Branch coverage of quote.ts is 100% and the suite runs in under one second.",
        "Git history shows at least one commit with failing tier-boundary tests followed by the commit that makes them pass.",
      ],
      hints: [
        "Write the worked example from the brief (Growth, 12 seats, monthly, DE = 42,126 cents) as your first test before anything else.",
        "Model percentages as basis points (10% = 1000) and do all multiplication before division, rounding once per line item.",
        "For graduated tiers, loop over tier brackets: seats in bracket = clamp(seats - bracketStart + 1, 0, bracketSize), and apply that bracket's rate only to those seats.",
        "Validate at the top of quote() with a small parser that receives unknown values and returns a typed input or throws InvalidQuoteInputError(field, message); test the parser through quote() using it.each tables.",
      ],
      rubric: [
        "Could a finance colleague reconstruct the pricing rules by reading only the test names?",
        "Does every expected value in the tests come from a hand calculation, not from running the implementation and copying its output?",
        "If I change any rate, boundary or cap by one unit, does at least one test fail?",
        "Are valid, rounding and invalid-input cases clearly separated and table-driven where repetitive?",
        "Is there any floating-point money anywhere in the implementation or tests?",
      ],
      stretchGoals: [
        "Add property-based tests with fast-check: for any valid input, total = net + VAT and the discount never exceeds the cap.",
        "Run Stryker mutation testing and reach a mutation score above 90% on quote.ts.",
        "Add mid-cycle proration for seat increases, developed strictly with red-green-refactor.",
      ],
      repoChecklist: [
        "README explaining the pricing rules, the rounding rule chosen and how to run the tests",
        "src/billing/quote.ts and its test file(s) with table-driven cases",
        "Coverage report summary or screenshot showing 100% branch coverage",
        "A GitHub Actions workflow running the tests on push, with a passing badge in the README",
      ],
      relatedLessons: ["unit-testing-business-logic", "ci-github-actions"],
    },
    {
      slug: "docker-capsule",
      title: "The Docker Capsule",
      kind: "exercise",
      summary:
        "Package an existing Node/TypeScript SaaS service into a minimal, non-root, multi-stage production image and prove it runs from raw docker commands with no host dependencies.",
      estimatedHours: 5,
      needsDiagram: false,
      requirements: [
        "Multi-stage Dockerfile with separate build, production-dependency and runtime stages on a pinned base image (no latest).",
        ".dockerignore excludes node_modules, .git, .env files and test output; docker history shows no secrets.",
        "The container runs as a non-root user and starts Node with exec-form CMD.",
        "SIGTERM triggers graceful shutdown; docker stop completes well under 10 seconds.",
        "A HEALTHCHECK reports healthy, and /readyz returns 503 when Postgres is unreachable.",
        "Missing or invalid required environment variables make the container exit at startup with a readable error.",
        "Changing only a .ts file and rebuilding shows the dependency install layer as CACHED.",
        "The README documents raw docker commands (network, Postgres, migrate, run, curl) that work on a machine with only Docker installed, plus a compose.yaml for local dev.",
      ],
      hints: [
        "Measure first: build the naive Dockerfile and record size and rebuild time so you can show the improvement.",
        "Copy package.json and package-lock.json before the source, and install production dependencies in their own stage with npm ci --omit=dev.",
        "The official node:alpine images already include a non-root user called node; use COPY --chown=node:node and USER node.",
        "If docker stop always takes exactly 10 seconds, your process is not receiving SIGTERM: check CMD form and add process.on('SIGTERM') that closes the server and the pool.",
      ],
      rubric: [
        "Would this image behave identically on my laptop, a CI runner and a production VM?",
        "Is there anything in the final image that is not needed at runtime?",
        "If an attacker got code execution in the app, would they be root in the container?",
        "Could a new teammate run the app from the README in under 10 minutes without asking me anything?",
        "Did I verify every claim with a command and paste its output, rather than assuming?",
      ],
      stretchGoals: [
        "Build a distroless variant and compare size and attack surface; replace the shell-based healthcheck with a tiny Node script.",
        "Scan the image with Trivy or Docker Scout and fix or document every high-severity finding.",
        "Build a multi-platform image (linux/amd64 and linux/arm64) with docker buildx.",
      ],
      repoChecklist: [
        "Dockerfile and .dockerignore at the repository root",
        "compose.yaml for local development with app and Postgres",
        "README with raw docker run instructions, before/after image size and rebuild times, and verification command output",
        "Health, readiness and graceful-shutdown code in the application source",
      ],
      relatedLessons: ["docker-fundamentals", "observability-after-deploy"],
    },
    {
      slug: "delivery-pipeline-design",
      title: "Design a SaaS Delivery Pipeline",
      kind: "design",
      summary:
        "Design the branching model, CI stages, registry, environments, gates, migration policy and rollback path for a 7-person invoicing SaaS team moving off manual SSH deploys.",
      estimatedHours: 4,
      needsDiagram: true,
      designPrompt:
        "Draw the full path of a change: feature branch, pull request, parallel CI stages and required checks, merge to main, image build with SHA tag, container registry, automatic staging deploy with expand-only migrations and smoke tests, approval gate, production rollout for API, frontend and worker (show the strategy for each), post-deploy verification fed by logs and metrics, and an explicit rollback path back to the previous image tag. Mark which gates are automated and which are human, where secrets are scoped, and where the migration linter and feature flags sit.",
      requirements: [
        "The diagram shows every stage from feature branch to production, including the registry and both staging and production environments.",
        "Each gate is labelled as automated or human and as blocking or advisory.",
        "API, frontend and background worker each have a named deployment strategy, and the worker design addresses in-flight jobs during rollout.",
        "The migration policy (expand/contract, when migrations run, how it is enforced in CI or review) is stated and would have prevented last month's dropped-column incident.",
        "The rollback path is drawn, with trigger, owner, expected duration, and a list of effects that cannot be rolled back.",
        "The design explains how production secrets are kept away from pull-request and fork workflows.",
        "DESIGN.md contains at least three explicit trade-offs and a rough monthly cost estimate.",
        "A step-by-step migration plan moves the team from the current process to the target without a big-bang switch.",
      ],
      hints: [
        "Start from the failure stories in the brief and make sure each one is stopped by a specific box on your diagram.",
        "Separate deploying from releasing: daily deploys of code behind feature flags can coexist with enterprise customers previewing features in staging before the flag is enabled in production.",
        "For the worker, think about SIGTERM handling: stop pulling new jobs, finish or requeue current ones, and make jobs idempotent so a retry cannot send a second dunning email.",
        "For migrations, run expand-only migrations as a pipeline step before the rollout, and add a migration linter (such as squawk) to CI that blocks DROP and RENAME unless the PR is labelled as a contract step.",
      ],
      rubric: [
        "Can I walk a change from 'git push' to 'customer sees it' using only my diagram?",
        "Does every incident in the brief map to a gate that would have stopped it?",
        "Is anything in the design more complex than a 7-person team without a platform engineer can operate?",
        "Are rollback limits (emails, charges, contract migrations) honestly stated?",
        "Would a new engineer understand where to look first when a deploy goes wrong?",
      ],
      stretchGoals: [
        "Add ephemeral preview environments per pull request and describe how their databases are seeded and destroyed.",
        "Define two SLOs (availability and latency for POST /invoices) and show how error-budget burn feeds into release decisions.",
        "Design a canary stage with automated promotion and abort criteria based on per-version error rate.",
      ],
      repoChecklist: [
        "README summarising the design and linking to the diagram and DESIGN.md",
        "Exported pipeline diagram (PNG or SVG) committed to the repository",
        "DESIGN.md covering all nine design areas, trade-offs and cost",
        "MIGRATION-PLAN.md with ordered transition steps",
      ],
      relatedLessons: ["ci-github-actions", "cd-zero-downtime-deploys", "observability-after-deploy"],
    },
    {
      slug: "production-cicd-pipeline",
      title: "The Production CI/CD Pipeline",
      kind: "capstone",
      summary:
        "Build a subscription billing API and a GitHub Actions pipeline that tests, checks formatting, builds and pushes a Docker image, and deploys it through staging to production with zero downtime and one-command rollback.",
      estimatedHours: 30,
      needsDiagram: true,
      designPrompt:
        "Draw the pipeline as built: PR workflow jobs (format, lint, typecheck, unit, integration with Postgres service, docker build) and their dependencies, branch protection on main, the release workflow (build and push SHA-tagged image to GHCR, migrations, staging deploy, smoke tests, production approval, production deploy, version verification), the runtime topology of staging and production (reverse proxy or platform, blue/green or rolling instances, Postgres), and the rollback workflow path. Label where secrets live and which steps are gates.",
      requirements: [
        "A PR workflow runs format check, lint, typecheck, unit tests, integration tests against a Postgres service container, and a non-pushing Docker build, and these are required checks on main.",
        "The release workflow builds once, tags the image with the short git SHA, pushes to GHCR with GITHUB_TOKEN, and deploys that same tag to staging and then production.",
        "Production deploys require approval through a GitHub production environment, use environment-scoped secrets, and use a concurrency group that never cancels an in-progress deploy.",
        "A curl loop during a production deploy shows zero non-200 responses, and a deploy whose readiness check fails leaves the previous version serving.",
        "Migrations run as a pipeline step before code rollout, and the repo history contains at least one expand/contract change split across multiple PRs.",
        "A rollback workflow_dispatch workflow redeploys a given previous tag and the pipeline verifies /version afterwards.",
        "The application emits structured JSON logs with version and request ID and exposes a request-duration histogram.",
        "PR feedback time is under 10 minutes and the README shows a passing workflow badge.",
      ],
      hints: [
        "Get the PR workflow and branch protection fully working before touching deployment; a reliable gate is the foundation for everything after it.",
        "Write one deploy script that takes an environment and an image tag, and call it from release.yml and rollback.yml so both paths are identical.",
        "On a single VPS, blue-green with two containers on different localhost ports and a Caddy or nginx reload is the simplest true zero-downtime setup; switch only after /readyz on the new container returns 200.",
        "Pass APP_VERSION as a Docker build arg equal to the image tag, expose it at /version, and after deploying poll the public /version until it matches, failing the job after a timeout.",
        "Do your first expand/contract by adding a column such as invoices.currency: PR 1 adds it nullable and dual-writes, a backfill step fills it, PR 2 reads from it and adds NOT NULL, PR 3 removes the old code path.",
      ],
      rubric: [
        "If a teammate merges a broken PR, which exact job stops it, and is it impossible to bypass without admin rights?",
        "Is the image running in production provably the same one that passed staging smoke tests?",
        "Have I actually demonstrated zero downtime, a failed deploy that kept the old version serving, and a rollback, with evidence in the README?",
        "Could anyone with access to a fork or a PR branch read production secrets or trigger a production deploy?",
        "Would I know within 15 minutes if a release broke invoice creation, and what would I do next?",
        "Is the pipeline simple enough that I could explain each job and why it exists in one sentence?",
      ],
      stretchGoals: [
        "Add a canary step: route a small share of traffic to the new version, compare its 5xx rate to the old version, and promote or abort automatically.",
        "Add per-PR preview environments that deploy the PR image to a temporary URL and tear down on close.",
        "Sign images with cosign and generate an SBOM, verifying the signature before deploy.",
        "Replace long-lived deploy keys with OIDC-based short-lived cloud credentials.",
      ],
      repoChecklist: [
        "README with architecture overview, setup instructions, and a passing GitHub Actions status badge",
        ".github/workflows/ci.yml, release.yml and rollback.yml",
        "Dockerfile, .dockerignore, compose.yaml and the deploy script",
        "Exported pipeline diagram (PNG or SVG) referenced from the README",
        "Evidence section: curl-loop output during a deploy, failed-readiness deploy log, rollback run link",
        "MIGRATIONS.md documenting the expand/contract policy and linking the PRs of the multi-step change",
      ],
      relatedLessons: [
        "unit-testing-business-logic",
        "integration-testing-postgres",
        "docker-fundamentals",
        "ci-github-actions",
        "cd-zero-downtime-deploys",
        "observability-after-deploy",
      ],
    },
  ],
  sources: [
    { label: "Docker Curriculum", url: "https://docker-curriculum.com", kind: "interactive" },
    { label: "Martin Fowler: Test Driven Development", url: "https://martinfowler.com/bliki/TestDrivenDevelopment.html", kind: "web" },
    { label: "Vitest Guide (TypeScript-native test runner)", url: "https://vitest.dev/guide/", kind: "docs" },
    { label: "GitHub Actions documentation", url: "https://docs.github.com/actions", kind: "docs" },
  ],
};
