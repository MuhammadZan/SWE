import type { PhaseMeta } from "@/lib/types";

export const phase: PhaseMeta = {
  id: 1,
  slug: "architecture",
  title: "Code Organization & Scalable Architectures",
  tagline: "Clean Architecture, Design Patterns, Modularity",
  objective:
    "Transition from single-file or loosely coupled scripts into predictable, enterprise-ready application layers.",
  overview:
    "You already know how to make features work. This phase is about making them stay workable: where code goes, what it is allowed to depend on, and how to keep business rules like invoicing, stock reservation and tenant isolation independent of the frameworks and databases you happen to use today.\n\nYou will learn the Dependency Rule behind layered, hexagonal and clean architecture, apply the same thinking to the frontend through design tokens and typed component libraries, and practice the three tools that make it real in TypeScript: SOLID principles, dependency injection with a composition root, and the repository pattern with units of work, plus the testing habits (in-memory fakes and repository contract suites) that prove those boundaries work.\n\nThe phase ends with the Modular ERP Core capstone, where you prove your boundaries are real by swapping the entire persistence layer from PostgreSQL to MongoDB by changing a single configuration value.",
  lessons: [
    {
      slug: "layered-clean-architecture",
      title: "Layered & Clean Architecture: Why Structure Matters",
      summary:
        "Separate business policy from technical detail with layers, ports and the Dependency Rule so that each concern has exactly one home.",
      minutes: 35,
      keyTakeaways: [
        "Policy (business rules) is the product; HTTP, ORMs and SDKs are replaceable details at the edge.",
        "The Dependency Rule: source code imports point inward toward the domain, never outward.",
        "Use cases talk to the outside world through ports (interfaces) owned by the application layer and implemented by infrastructure adapters.",
        "Feature-first modules with layers inside (a modular monolith) scale better than giant controllers/services/repositories folders.",
        "Enforce boundaries with tooling (ESLint restricted imports, dependency-cruiser), because folder names alone are not architecture.",
        "Match the investment to the domain: thin CRUD needs little structure, billing and inventory logic needs a lot.",
      ],
      quiz: [
        {
          question:
            "Your CSV import job, the public API and the dashboard each contain their own copy of the invoice total calculation, and a rounding fix was applied to only one. Which structural change best prevents this class of bug?",
          options: [
            "Move the calculation into a shared utils.ts file that all three import",
            "Put the rule in the Invoice domain model and have all three entry points call the same CreateInvoice use case",
            "Add an integration test for each entry point",
            "Move the calculation into a Postgres stored procedure",
          ],
          answer: 1,
          explanation:
            "The root problem is that a business rule lives in delivery code. Putting the invariant in the domain and routing every entry point through one use case gives the rule a single home. A utils file helps, but it does not stop callers from skipping it or reimplementing the orchestration. Tests detect drift but do not prevent it. A stored procedure moves policy into a detail.",
        },
        {
          question:
            "A teammate puts the InvoiceRepository interface in infrastructure/prisma/ next to PrismaInvoiceRepository, and the CreateInvoice use case imports it from there. What is wrong?",
          options: [
            "Nothing; interfaces can live anywhere in TypeScript",
            "The application layer now depends on the infrastructure layer, which violates the Dependency Rule; the consumer (application) should own the port",
            "Interfaces must always be in a shared/ folder",
            "Prisma requires interfaces to be generated, not hand-written",
          ],
          answer: 1,
          explanation:
            "Dependency inversion only works when the high-level module owns the abstraction. If the port lives in infrastructure, the import arrow points outward again, and the use case is coupled to the infrastructure package's folder and lifecycle.",
        },
        {
          question:
            "You are building an internal admin screen that lists and edits feature flags. There are no business rules beyond 'name must be unique'. What is the most reasonable structure?",
          options: [
            "Full hexagonal architecture with domain entities, use cases, ports and adapters",
            "A thin handler or service calling the ORM directly, keeping it isolated from core modules",
            "Microservice with its own database",
            "Put the logic in the React component to avoid a backend",
          ],
          answer: 1,
          explanation:
            "Architecture costs indirection, so match it to domain complexity. Simple CRUD with almost no rules does not benefit from rich domain layering. A thin service isolated from the core is pragmatic. Microservices add operational cost, and putting writes in the client bypasses validation and security.",
        },
        {
          question:
            "In a hexagonal architecture, CreateInvoice calls invoices.save(), which ends up executing SQL. Which statement about dependencies is correct?",
          options: [
            "Runtime control flow and compile-time imports both point from the use case to Postgres",
            "Runtime control flows outward to Postgres, but the compile-time import points inward: the Postgres adapter imports the port interface",
            "The use case imports the Postgres adapter, and the adapter imports nothing",
            "Neither direction matters as long as tests pass",
          ],
          answer: 1,
          explanation:
            "This is the core trick of dependency inversion. Calls go use case -> port -> adapter -> DB at runtime, but the source code dependency is adapter -> port. That is why the adapter can be replaced without touching the use case.",
        },
        {
          question:
            "Your ERP's inventory module imports a helper from invoicing/infrastructure/margin-query.ts, and invoicing imports stock types from inventory/domain. What is the main risk, and the fix?",
          options: [
            "Performance; merge the modules into one file",
            "A cyclic, internals-level coupling between modules; expose what is needed through each module's public API (index.ts) or a port/event, and forbid deep imports with lint rules",
            "TypeScript compile time; use JavaScript instead",
            "No risk, because they are in the same monolith",
          ],
          answer: 1,
          explanation:
            "Deep imports into another module's internals, especially in both directions, create a hidden cycle. A change in either module can break the other, and the modules can never be separated. Public APIs plus enforced boundary rules keep a modular monolith modular.",
        },
      ],
      resources: [
        {
          label: "The Clean Architecture (Robert C. Martin)",
          url: "https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html",
          kind: "web",
        },
        {
          label: "Hexagonal Architecture (Alistair Cockburn)",
          url: "https://alistair.cockburn.us/hexagonal-architecture/",
          kind: "web",
        },
        {
          label: "Presentation Domain Data Layering (Martin Fowler)",
          url: "https://martinfowler.com/bliki/PresentationDomainDataLayering.html",
          kind: "web",
        },
        {
          label: "dependency-cruiser (enforce import rules)",
          url: "https://github.com/sverweij/dependency-cruiser",
          kind: "docs",
        },
      ],
    },
    {
      slug: "design-systems-tokens",
      title: "Design Systems & Design Tokens",
      summary:
        "Apply architectural thinking to the frontend: centralize every visual decision in tiered design tokens and expose it through strictly typed components.",
      minutes: 30,
      keyTakeaways: [
        "A design token is a named decision (color.danger.fg), not a value (#991b1b); components reference decisions.",
        "Use three tiers: primitives (raw palette and scales), semantic tokens (meaning, where theming happens), and optional component tokens.",
        "CSS custom properties plus a TypeScript token module give runtime theming (dark mode, white-label) with compile-time safety.",
        "Constrained, union-typed component props are a feature: no color or style escape hatches means the system cannot be bypassed casually.",
        "Prefer composition (Card.Header, Card.Body) over dozens of boolean props.",
        "Accessibility (ARIA roles, focus traps, contrast) is centralized in the design system and fixed once.",
      ],
      quiz: [
        {
          question:
            "Marketing rebrands from blue to green. Your codebase has tokens named color.blue500 used directly in 200 components. What went wrong in the token design?",
          options: [
            "Nothing; change color.blue500 to green",
            "Components referenced primitive, value-named tokens instead of semantic ones like color.accent, so the name now lies or every usage must change",
            "The tokens should have been hex strings in each component",
            "They should have used Tailwind's default palette",
          ],
          answer: 1,
          explanation:
            "Primitives describe values, semantic tokens describe intent. Components should depend on intent (accent, danger, muted) so that remapping intent to a new primitive is a one-line change that does not leave misleading names behind.",
        },
        {
          question:
            "You need a dark theme for warehouse terminals with zero flash on page load in a server-rendered Next.js app. Which approach fits best?",
          options: [
            "A React context that passes JS color objects to every component and re-renders on toggle",
            "Semantic CSS custom properties redefined under [data-theme=dark], with components reading the variables",
            "A second copy of every component with dark styles",
            "Inline styles computed in useEffect after mount",
          ],
          answer: 1,
          explanation:
            "CSS variables switch instantly, work during SSR (the attribute can be set before hydration), and require no component re-render or duplication. JS-driven theming causes re-renders and often a flash of the wrong theme.",
        },
        {
          question:
            "A developer asks you to add a color: string prop to the shared Alert so they can make a 'special purple' alert for one screen. What is the best response?",
          options: [
            "Add the prop; flexibility is good",
            "Tell them to copy Alert and modify it",
            "Discuss whether this is a new semantic tone; if so add it to the Tone union and the token file, otherwise use an existing tone",
            "Let them pass a className and override styles with !important",
          ],
          answer: 2,
          explanation:
            "Arbitrary color props turn the design system into a suggestion, and within months every alert has a slightly different color. A new tone, if justified, should go through the token layer and type union so it is reviewed and consistent everywhere.",
        },
        {
          question:
            "Your Card component has 23 boolean props (hasHeader, compactHeader, footerRight, noBorder, and so on) and every new screen adds another. Which refactor addresses the root cause?",
          options: [
            "Replace the booleans with a single options object",
            "Switch to compound components (Card.Header, Card.Body, Card.Footer) that consumers compose, each styled from tokens",
            "Add more default props",
            "Split it into Card1 through Card5",
          ],
          answer: 1,
          explanation:
            "A configuration explosion is a sign the component is trying to anticipate every layout. Composition lets consumers assemble structure while the sub-components keep spacing and borders consistent through tokens. An options object just moves the same 23 flags.",
        },
        {
          question:
            "An accessibility audit finds that warning text fails contrast in dark mode on 40 screens. In a token-driven system, where is the fix?",
          options: [
            "On each of the 40 screens",
            "In the dark theme's semantic token values for the warning fg/bg pair, verified once for contrast",
            "In a global CSS override with !important",
            "Disable dark mode",
          ],
          answer: 1,
          explanation:
            "Because every component reads the same semantic warning tokens, fixing the pair in the dark theme fixes every usage. This is the core payoff of centralizing decisions.",
        },
      ],
      resources: [
        {
          label: "Design Tokens Community Group format",
          url: "https://www.designtokens.org/",
          kind: "docs",
        },
        {
          label: "Style Dictionary (build tokens for multiple platforms)",
          url: "https://styledictionary.com/",
          kind: "docs",
        },
        {
          label: "GitHub Primer design system",
          url: "https://primer.style/",
          kind: "web",
        },
        {
          label: "MDN: Using CSS custom properties",
          url: "https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties",
          kind: "docs",
        },
      ],
    },
    {
      slug: "solid-principles",
      title: "SOLID Principles in TypeScript",
      summary:
        "Learn the five SOLID principles through bad-to-good refactors of real SaaS code, and when each one is worth applying.",
      minutes: 40,
      keyTakeaways: [
        "SRP means one actor (group of stakeholders) per module, not one function per class.",
        "OCP: add new behavior along expected axes of change (discount types, providers) by adding code, often with the strategy pattern; do not build it before the third variant.",
        "LSP: an implementation that throws 'not supported' or demands stricter inputs breaks the contract; split the interface instead.",
        "ISP: small role interfaces (StockReader, StockReservations) keep consumers and test fakes minimal.",
        "DIP: business policy owns the abstraction, and infrastructure conforms to it.",
        "SOLID serves cheaper change; abstractions that make likely changes harder should be removed.",
      ],
      quiz: [
        {
          question:
            "InvoiceService computes tax (Finance asks for changes), renders the PDF (Sales asks for changes), and sends reminder emails (Customer Success asks for changes). A PDF footer change broke a tax test due to a bad merge. Which principle is most directly violated?",
          options: ["Open/Closed", "Single Responsibility", "Liskov Substitution", "Interface Segregation"],
          answer: 1,
          explanation:
            "SRP is about having one reason to change, meaning one actor. Three groups requesting changes in one class is exactly the situation SRP warns against, and incidental breakage like this is the symptom.",
        },
        {
          question:
            "Your PaymentGateway interface has charge() and refund(). The new BankTransferGateway implements refund() by throwing 'not supported', and cancelOrder() now crashes for bank-transfer customers. What is the best fix?",
          options: [
            "Wrap every refund() call in try/catch",
            "Add an instanceof BankTransferGateway check in cancelOrder",
            "Split the interface so only RefundableGateway has refund(), and handle non-refundable gateways explicitly",
            "Make refund() return undefined silently",
          ],
          answer: 2,
          explanation:
            "This is an LSP violation caused by an interface that is too broad (an ISP problem). Splitting the interface makes the true capabilities visible in the type system. Catching errors or instanceof checks spread knowledge of concrete types across callers, and silently doing nothing hides a business problem.",
        },
        {
          question:
            "A switch over discount types in subscription billing has had the same three cases for three years and nobody expects new ones. A colleague wants to replace it with a plugin registry for OCP. What do you advise?",
          options: [
            "Do it; OCP should always be applied",
            "Leave the switch for now; OCP pays off along axes that actually change, and you can refactor when new variants start arriving",
            "Replace it with if/else chains",
            "Move it to the database",
          ],
          answer: 1,
          explanation:
            "OCP targets expected axes of change. Adding indirection to stable code costs readability with no payoff. The pragmatic rule is to refactor toward a strategy when the third or fourth variant appears.",
        },
        {
          question:
            "The storefront's 'in stock' badge depends on an InventoryStore interface with 9 methods, including valuation reports and Shopify sync. Its test fake must stub all 9. Which principle and refactor apply?",
          options: [
            "DIP: inject a concrete PostgresInventory instead",
            "ISP: define a small StockReader interface with only getStockLevel and depend on that",
            "SRP: move the badge into the inventory module",
            "LSP: make the fake extend the real class",
          ],
          answer: 1,
          explanation:
            "Clients should not depend on methods they do not use. A role interface narrows the dependency, makes the fake trivial, and insulates the badge from changes to reporting or sync methods. One class can still implement several role interfaces.",
        },
        {
          question:
            "Which change best demonstrates the Dependency Inversion Principle for a RenewSubscription use case that currently calls new Stripe(...) and prisma directly?",
          options: [
            "Wrap Stripe in a StripeService class and import it in RenewSubscription",
            "Define PaymentCollector and SubscriptionRepository interfaces in the billing application layer, have RenewSubscription depend on them, and implement them in infrastructure",
            "Move the Stripe key to an environment variable",
            "Create an IStripe interface in the Stripe adapter folder that mirrors the Stripe SDK",
          ],
          answer: 1,
          explanation:
            "DIP means high-level policy depends on abstractions that it owns, shaped by its own needs. A wrapper class still couples policy to a concrete class. An interface that mirrors the SDK and lives with the adapter is owned by the detail, not the policy.",
        },
      ],
      resources: [
        {
          label: "Clean Code by Robert C. Martin",
          url: "https://www.oreilly.com/library/view/clean-code-a/9780136083238/",
          kind: "book",
        },
        {
          label: "Refactoring.Guru: Design Patterns (Strategy, and more)",
          url: "https://refactoring.guru/design-patterns",
          kind: "interactive",
        },
        {
          label: "The Single Responsibility Principle (Uncle Bob)",
          url: "https://blog.cleancoder.com/uncle-bob/2014/05/08/SingleReponsibilityPrinciple.html",
          kind: "web",
        },
      ],
    },
    {
      slug: "dependency-injection",
      title: "Dependency Injection Without Frameworks",
      summary:
        "Hand components their collaborators through constructors, assemble everything in one composition root, and get fast, deterministic tests.",
      minutes: 35,
      keyTakeaways: [
        "DI means a component receives its dependencies instead of constructing or looking them up; containers are optional tooling.",
        "Constructor injection is the default: dependencies are explicit, readonly, and the object is never half-built.",
        "The composition root is the single place per process that knows every concrete class and wires the graph, with no business logic.",
        "Request-scoped data such as tenant, user or transaction must never be stored on singleton services.",
        "Injected ports enable hand-written fakes, including Clock and IdGenerator, for millisecond-fast, deterministic unit tests.",
        "DIP is the principle (depend on abstractions owned by policy); DI is the mechanism that supplies implementations.",
      ],
      quiz: [
        {
          question:
            "A ReorderService has constructor(private container: Container) and calls this.container.get('inventoryRepo') inside its methods. Why is this a problem even though nothing is created with new?",
          options: [
            "It is slower than direct imports",
            "It is a service locator: real dependencies are hidden from the signature, tests must configure a whole container, and missing registrations fail at runtime",
            "Containers cannot be passed as constructor arguments in TypeScript",
            "There is no problem; this is standard DI",
          ],
          answer: 1,
          explanation:
            "Injecting the container gives you the downsides of globals with extra steps. Inject the specific ports the service needs so its dependencies are visible, type-checked and easy to fake.",
        },
        {
          question:
            "Under load, tenant A occasionally sees tenant B's purchase orders. The PurchaseOrderService singleton has a setTenant(tenantId) method called by middleware before each request. What is the root cause?",
          options: [
            "Postgres connection pooling",
            "Request-scoped state stored on a process-wide singleton, so concurrent requests overwrite each other's tenant",
            "Missing database indexes",
            "The middleware runs too late",
          ],
          answer: 1,
          explanation:
            "Node handles many requests concurrently on one process. A singleton's mutable field is shared across all of them. Tenant context must be passed as a method argument or held in a per-request scope.",
        },
        {
          question:
            "You want to switch notifications from Slack to email for one deployment. With a proper composition root in place, how many files should change?",
          options: [
            "Every use case that sends notifications",
            "One: the composition root (plus the new EmailNotifier adapter itself)",
            "All test files",
            "The Notifier interface and every implementation",
          ],
          answer: 1,
          explanation:
            "Use cases depend on the Notifier port. Only the composition root chooses which implementation to construct, so adding an adapter and changing one wiring line is the whole change.",
        },
        {
          question:
            "Your trial-expiry logic uses new Date() internally, and its tests fail on the last day of each month. What is the DI-friendly fix?",
          options: [
            "Mock the global Date with a library in every test",
            "Inject a Clock port ({ now(): Date }) and pass a fixed clock in tests and the system clock in the composition root",
            "Skip the tests on the last day of the month",
            "Use Date.now() instead of new Date()",
          ],
          answer: 1,
          explanation:
            "Time is a hidden dependency. Making it an injected port makes behavior deterministic and explicit. Global Date mocking works, but it is fragile and leaks between tests.",
        },
        {
          question:
            "A use case's constructor has grown to 9 injected dependencies. A teammate proposes adopting a DI container so the wiring is automatic. What is the better first response?",
          options: [
            "Adopt the container; long constructors are just a wiring inconvenience",
            "Treat it as an SRP signal: the use case probably does several jobs and should be split",
            "Switch to property injection so the constructor is shorter",
            "Group all dependencies into one 'deps: any' object",
          ],
          answer: 1,
          explanation:
            "Constructor injection makes excessive dependencies visible on purpose. A container hides the symptom without fixing the design. Splitting responsibilities reduces both the dependency count and the change risk.",
        },
      ],
      resources: [
        {
          label: "Inversion of Control Containers and the Dependency Injection pattern (Martin Fowler)",
          url: "https://martinfowler.com/articles/injection.html",
          kind: "web",
        },
        {
          label: "NestJS: Providers and dependency injection",
          url: "https://docs.nestjs.com/providers",
          kind: "docs",
        },
        {
          label: "Mocks Aren't Stubs (Martin Fowler)",
          url: "https://martinfowler.com/articles/mocksArentStubs.html",
          kind: "web",
        },
      ],
    },
    {
      slug: "testing-from-day-one",
      title: "Testing From Day One: Fakes, Contracts and Fast Feedback",
      summary:
        "Set up Vitest in a TypeScript project, test use cases with in-memory fakes injected through constructors, and keep those fakes honest with a contract suite shared by every repository implementation.",
      minutes: 35,
      keyTakeaways: [
        "Layered code with injected ports is what makes testing cheap: a use-case test is plain TypeScript with in-memory fakes and no database.",
        "Vitest runs TypeScript directly but does not type-check, so run tsc --noEmit as a separate script and in CI.",
        "Prefer hand-written fakes that implement the real port interfaces, and assert on outcomes rather than on which methods were called.",
        "A contract test suite is a function that takes a factory; running it against the in-memory and the real repositories proves they are substitutable.",
        "Test domain invariants, use-case orchestration, tenant scoping and mapping; skip framework behavior and trivial getters.",
        "Keep the unit suite under a couple of seconds: no I/O, injected Clock and IdGenerator, fresh fakes per test, and a separate integration project for the database.",
      ],
      quiz: [
        {
          question:
            "Your unit tests for CreateInvoice all pass using InMemoryInvoiceRepository, yet production leaked an invoice across tenants. The Postgres repository's findById forgot the tenant filter. What would have caught this?",
          options: [
            "More unit tests for CreateInvoice",
            "A repository contract suite, including a 'never returns another tenant's invoice' case, run against both the in-memory and Postgres implementations",
            "Raising line coverage to 100%",
            "Mocking the Postgres client in the use-case tests",
          ],
          answer: 1,
          explanation:
            "Use-case tests only exercise the fake, so they cannot detect a bug in the real adapter. A shared contract suite holds every implementation to the same behavior, including tenant isolation. Coverage and mocks of the client say nothing about the actual SQL.",
        },
        {
          question:
            "A teammate's test for IssueInvoice asserts expect(repo.save).toHaveBeenCalledTimes(1) and expect(numbers.next).toHaveBeenCalledWith('t1', 2026). A harmless refactor that saves after a validation step breaks it. What is the better approach?",
          options: [
            "Add more call-count assertions so the test is stricter",
            "Assert on outcomes: load the invoice from the in-memory fake and check its status and number",
            "Delete the test, since refactors break tests anyway",
            "Switch from Vitest to Jest",
          ],
          answer: 1,
          explanation:
            "Interaction assertions couple the test to implementation steps. Checking the observable result through a stateful fake verifies the business behavior and survives refactoring.",
        },
        {
          question:
            "CI is green, but the build fails on deploy with a TypeScript error in a test helper. All tests ran under Vitest. Why did CI miss it?",
          options: [
            "Vitest only runs JavaScript files",
            "Vitest transforms TypeScript without type-checking, so a separate tsc --noEmit step is needed",
            "The test helper was not imported",
            "Type errors only appear in production builds",
          ],
          answer: 1,
          explanation:
            "Vitest strips types with esbuild for speed. Code with type errors can still execute and pass. A separate typecheck script in CI closes that gap.",
        },
        {
          question:
            "Trial-expiry tests pass locally but fail in CI on the last day of each month. The domain code calls new Date() directly. What is the most robust fix?",
          options: [
            "Retry flaky tests automatically in CI",
            "Inject a Clock port and pass a fixed clock in the tests",
            "Run CI only in the middle of the month",
            "Increase the test timeout",
          ],
          answer: 1,
          explanation:
            "Time is a hidden dependency. An injected clock makes the behavior deterministic. Retries hide the bug, and the timeout is unrelated.",
        },
        {
          question:
            "Your unit suite has grown to 90 seconds, and developers have stopped running it before pushing. Profiling shows most tests open a Postgres connection to seed fixtures. What change gives the biggest improvement?",
          options: [
            "Buy faster CI machines",
            "Move business-rule tests onto in-memory fakes and keep database tests in a separate integration project covered by the repository contract suite",
            "Run all tests in parallel against the same database",
            "Remove the slowest tests",
          ],
          answer: 1,
          explanation:
            "Most business logic does not need a database to be tested. Moving it onto fakes makes the unit suite near-instant, while the contract suite and a few integration tests still verify the real adapter. Sharing one database in parallel usually makes tests flaky.",
        },
      ],
      resources: [
        {
          label: "Vitest guide",
          url: "https://vitest.dev/guide/",
          kind: "docs",
        },
        {
          label: "The Practical Test Pyramid (Ham Vocke, martinfowler.com)",
          url: "https://martinfowler.com/articles/practical-test-pyramid.html",
          kind: "web",
        },
        {
          label: "Mocks Aren't Stubs (Martin Fowler)",
          url: "https://martinfowler.com/articles/mocksArentStubs.html",
          kind: "web",
        },
        {
          label: "Testcontainers for Node.js",
          url: "https://node.testcontainers.org/",
          kind: "docs",
        },
      ],
    },
    {
      slug: "repository-pattern",
      title: "The Repository Pattern & Unit of Work",
      summary:
        "Isolate all persistence behind collection-like, domain-language interfaces, map at the edge, and make multi-aggregate changes atomic with a unit of work.",
      minutes: 40,
      keyTakeaways: [
        "A repository acts like an in-memory collection of domain objects, speaks domain language, and returns domain types, never ORM rows.",
        "Use one repository per aggregate root (Invoice with its lines), not one per table.",
        "Mapping (toDomain/toRow) at the infrastructure edge is what lets storage change without touching the domain.",
        "A Unit of Work gives a use case transaction-bound repositories so changes across aggregates commit or roll back together.",
        "Serve complex reads (lists, dashboards, exports) from query services that return DTOs instead of forcing them through repositories.",
        "A generic pass-through Repository<T> over an ORM is usually overkill; use the pattern where invariants, tenancy or swappability matter.",
      ],
      quiz: [
        {
          question:
            "Your InvoiceRepository interface exposes findMany(where: Prisma.InvoiceWhereInput): Promise<Prisma.Invoice[]>. The team now needs to move invoices to MongoDB. What is the problem?",
          options: [
            "Mongo does not support findMany",
            "The interface leaks Prisma types, so every caller is coupled to Prisma and the abstraction provides no portability",
            "Repositories should only have one method",
            "Nothing; just write a Prisma-to-Mongo adapter",
          ],
          answer: 1,
          explanation:
            "A repository's value comes from speaking the domain's language. ORM input and output types in the signature mean the application layer already depends on Prisma, and swapping storage means rewriting every caller.",
        },
        {
          question:
            "A developer adds InvoiceLineRepository.save(line) so the UI can update a single line's quantity directly. Why might a reviewer push back?",
          options: [
            "Too many repositories slow down the app",
            "It bypasses the Invoice aggregate, so invariants like 'only draft invoices can be edited' and total recalculation are skipped",
            "Lines should be stored as JSON",
            "Repositories cannot save child entities",
          ],
          answer: 1,
          explanation:
            "Repositories are per aggregate root so that all changes go through the root, which enforces invariants. Saving a child directly lets callers edit an issued invoice or leave totals inconsistent.",
        },
        {
          question:
            "Issuing an invoice must mark it issued, decrement stock for each line, and append a ledger entry. Stock decrement for line 3 fails because it would oversell. What should happen, and which pattern ensures it?",
          options: [
            "Lines 1 and 2 stay decremented; fix it with a nightly reconciliation job",
            "All changes roll back; a Unit of Work runs the use case with repositories bound to a single transaction",
            "Each repository retries until it succeeds",
            "The invoice is marked issued with a warning flag",
          ],
          answer: 1,
          explanation:
            "Business operations spanning aggregates must be atomic. A Unit of Work (for example a $transaction wrapper that hands out tx-bound repositories) gives the use case one commit/rollback boundary without importing the ORM.",
        },
        {
          question:
            "The invoices list page needs pagination, sorting, five joined tables and aggregate totals per customer. Loading full Invoice aggregates through the repository is slow. What is the recommended approach?",
          options: [
            "Add 15 optional filter parameters to InvoiceRepository and load aggregates anyway",
            "Use a separate read-side query service (still tenant-scoped, behind an interface) that runs optimized SQL and returns DTOs",
            "Cache all invoices in memory",
            "Let the React component query the database directly",
          ],
          answer: 1,
          explanation:
            "Repositories are optimized for loading aggregates in order to change them. Reads that are complex or high-volume belong in a query service or read model. This CQRS-lite split keeps writes clean and reads fast.",
        },
        {
          question:
            "In which situation is introducing the repository pattern most likely overkill?",
          options: [
            "Multi-tenant invoicing with numbering, tax rules and atomic stock updates",
            "An internal admin tool that edits a lookup table with no rules, where the ORM will never be replaced",
            "A capstone requiring Postgres and MongoDB to be swappable",
            "A billing module whose rules need fast unit tests",
          ],
          answer: 1,
          explanation:
            "Repositories pay for themselves when there are invariants, tenancy rules to centralize, a need to swap persistence, or business logic to test in isolation. Thin CRUD over a stable ORM gains little from an extra layer.",
        },
      ],
      resources: [
        {
          label: "Repository (Martin Fowler, P of EAA catalog)",
          url: "https://martinfowler.com/eaaCatalog/repository.html",
          kind: "web",
        },
        {
          label: "Unit of Work (Martin Fowler, P of EAA catalog)",
          url: "https://martinfowler.com/eaaCatalog/unitOfWork.html",
          kind: "web",
        },
        {
          label: "Prisma: Transactions and batch queries",
          url: "https://www.prisma.io/docs/orm/prisma-client/queries/transactions",
          kind: "docs",
        },
        {
          label: "DDD Aggregate (Martin Fowler)",
          url: "https://martinfowler.com/bliki/DDD_Aggregate.html",
          kind: "web",
        },
      ],
    },
  ],
  problems: [
    {
      slug: "user-repository-separation",
      title: "The Separation: Extract a UserRepository",
      kind: "exercise",
      summary:
        "Split a monolithic create-user route handler into a thin handler, a CreateUser use case, and a UserRepository with SQL isolated in infrastructure.",
      estimatedHours: 5,
      needsDiagram: false,
      requirements: [
        "A UserRepository interface lives in the application layer, with intention-revealing methods that all require tenantId.",
        "All SQL or ORM calls are inside a single infrastructure implementation with explicit toDomain/toRow mapping; grep finds none elsewhere.",
        "A CreateUser use case receives UserRepository, a seat-limit port and a PasswordHasher port via constructor injection.",
        "The route handler only validates input shape, calls the use case, maps domain errors to HTTP codes (400/402/409/201), and returns a DTO.",
        "The response never includes password_hash, verified by an automated test.",
        "Unit tests for CreateUser run with in-memory fakes and pass with the database stopped.",
        "At least one integration test exercises the real repository against a real Postgres instance.",
        "Swapping to an InMemoryUserRepository requires changing only the composition root.",
      ],
      hints: [
        "Before writing code, list every responsibility in the legacy handler and label each one: HTTP, validation, business rule, data access or side effect.",
        "Start with the use case and its port interfaces, written as if the database did not exist. Implement the repository last.",
        "Make Email a value object with a static parse() that trims, lowercases and validates, so normalization cannot be forgotten by callers.",
        "Define domain error classes (ConflictError, SeatLimitError, ValidationError) and map them to status codes in one small function in the HTTP layer.",
        "For the integration test, run Postgres via docker compose or Testcontainers, apply your migration, and truncate tables in beforeEach.",
      ],
      rubric: [
        "Could a new developer find every place tenant isolation is enforced by opening one file?",
        "Does any file outside infrastructure import your DB library or contain SQL?",
        "Do the use-case tests read like business specifications rather than mock setups?",
        "Is the status-code behavior identical to the legacy handler for all four cases?",
        "Is the composition root the only place where concrete classes are constructed?",
        "If two requests create the same email at the same moment, does a unique index still prevent the duplicate, and does that surface as a 409 rather than a 500?",
      ],
      stretchGoals: [
        "Add a dependency-cruiser config that fails CI when application/ imports infrastructure/.",
        "Write a repository contract test suite and run it against both the in-memory and Postgres implementations.",
        "Add soft delete (deletedAt) and prove with tests that deleted users neither count toward seats nor block email reuse.",
      ],
      repoChecklist: [
        "README with setup and run instructions (docker compose up, migrate, seed, start, test commands)",
        "A short before/after section in the README listing the responsibilities you separated",
        "Use-case unit tests (with fakes, no database) and at least one repository integration test, runnable with a single npm script each",
        "SQL migration or schema file plus a seed script",
        "Lint or dependency-cruiser config enforcing the layer boundary",
      ],
      relatedLessons: ["repository-pattern", "dependency-injection", "testing-from-day-one", "layered-clean-architecture"],
    },
    {
      slug: "design-tokens-component-library",
      title: "Design Tokens: Alert, Card & Modal Library",
      kind: "exercise",
      summary:
        "Build a themeable Alert, Card and Modal library in which every color, spacing and radius value comes from a centralized, tiered token layer.",
      estimatedHours: 7,
      needsDiagram: false,
      requirements: [
        "Primitive and semantic token files exist; components reference only semantic tokens.",
        "No hex/rgb/hsl literals or raw px/rem values appear in src/components/**, enforced by an automated check that fails when one is added.",
        "Light, dark and one brand theme switch at runtime with a data-theme attribute and no component code changes.",
        "Alert supports exactly four union-typed tones and uses role=alert for danger and role=status otherwise, verified by a component test for each tone.",
        "Card is built with composition (Card.Header, Card.Body, Card.Footer) with token-driven padding and dividers.",
        "Modal closes on Escape, keeps focus inside while open, returns focus to the trigger, and sets aria-modal and aria-labelledby, with automated tests for Escape, onClose and focus return.",
        "All Alert foreground/background pairs meet WCAG AA 4.5:1 contrast in light and dark themes, with results documented.",
        "A demo page shows an ERP scenario (overdue invoice alert, stock valuation card, void invoice confirmation modal) with a theme switcher.",
      ],
      hints: [
        "Write the semantic token names first, based on what the UI means (surface, text, border, danger, and so on), then map them to primitives.",
        "Generate or hand-write CSS variables for :root and [data-theme=dark]; your TS semantic module can just hold var(--...) strings for type safety.",
        "For the guard, a Vitest test that reads every file under src/components and asserts no match for a hex or px/rem regex is enough.",
        "Native <dialog> with showModal() gives you Escape handling and makes the rest of the page inert. Current browsers also restore focus on close, but store the trigger yourself and test it, because the trigger may re-render or the dialog may be closed by unmounting.",
        "Test the modal with Testing Library's userEvent.keyboard('{Escape}') and userEvent.tab(), asserting on document.activeElement. jsdom does not implement HTMLDialogElement.showModal(), so stub showModal/close in your test setup or run these tests in a real browser (Vitest browser mode or Playwright).",
      ],
      rubric: [
        "If the brand's accent color changed tomorrow, how many files would you edit?",
        "Could a teammate accidentally create a fifth alert tone or a custom color without the type checker or lint guard noticing?",
        "Are your semantic token names about meaning rather than appearance?",
        "Does the modal work fully with only a keyboard?",
        "Are component APIs small enough to understand from their TypeScript types alone?",
      ],
      stretchGoals: [
        "Publish the components in Storybook with a theme toolbar and accessibility addon.",
        "Generate the CSS variables and the TS token module from a single JSON source using Style Dictionary.",
        "Add visual regression tests (Playwright screenshots) for each component in each theme.",
        "Add a Button with cva-style intent and size variants and use it in the Modal footer.",
      ],
      repoChecklist: [
        "README with install and run instructions for the demo and tests, plus a token architecture explanation",
        "Screenshots or a GIF of the demo in light, dark and brand themes",
        "Component tests and the hardcoded-value guard, runnable with one npm script",
        "A contrast results table for the semantic color pairs in each theme",
      ],
      relatedLessons: ["design-systems-tokens", "solid-principles", "testing-from-day-one"],
    },
    {
      slug: "multi-tenant-erp-module-map",
      title: "Design: Multi-Tenant ERP Module & Dependency Map",
      kind: "design",
      summary:
        "Draw the target layered module architecture for a multi-tenant ERP monolith, showing allowed dependencies, port ownership, events and tenant isolation.",
      estimatedHours: 4,
      needsDiagram: true,
      designPrompt:
        "Draw every ERP module (Identity & Tenancy, Catalog, Inventory, Purchasing, Sales, Invoicing, Accounting, Platform Billing, Shared Kernel) as a box, with arrows showing allowed dependencies and their direction and no cycles. For at least two modules, show the internal layers (domain, application, infrastructure, interface). Mark where each port interface lives and which adapter implements it, distinguish synchronous public-API calls from asynchronous domain events (such as InvoiceIssued and GoodsReceived), show where tenant isolation is enforced, and show the composition roots for the web and worker processes.",
      requirements: [
        "Every listed capability area is assigned to a module, and any merges or splits are justified in the write-up.",
        "All inter-module arrows are directional and the graph contains no cycles.",
        "At least two modules show their internal layers, with all internal arrows pointing inward.",
        "Each port names its owning module/layer and at least one implementing adapter.",
        "Each of the four cross-module flows is traceable on the diagram and labeled as a sync call or an async event, with reasoning.",
        "Accounting has no dependency on Invoicing, Purchasing or Sales.",
        "Tenant isolation enforcement points and the web/worker composition roots are marked.",
        "A 500 to 900 word write-up explains the boundaries, the Shared Kernel contents, and the main trade-offs.",
      ],
      hints: [
        "Start from the most stable, least dependent modules (Shared Kernel, Identity & Tenancy, Catalog) and place them at the bottom; volatile, orchestrating modules go higher.",
        "When two modules seem to need each other, ask which one is the policy and which is the detail, then invert one direction with a port owned by the policy side or with a domain event.",
        "For Accounting independence: let Invoicing and Purchasing publish events (or call an Accounting public API with Accounting-defined commands) so Accounting never imports their types.",
        "For past-due tenants, consider a TenantWriteGuard port checked in the application layer of every module, implemented by Platform Billing, rather than every module calling Stripe.",
      ],
      rubric: [
        "Could two developers independently implement different modules from this diagram and have them fit together?",
        "Is there any arrow that points from a stable module toward a volatile one?",
        "Is the Shared Kernel genuinely tiny, with every item justified?",
        "Would adding a Manufacturing (Bill of Materials) module require changes to existing modules' internals?",
        "Does the write-up acknowledge costs, such as eventual consistency from events or extra indirection?",
      ],
      stretchGoals: [
        "Write a dependency-cruiser config that encodes your diagram's allowed arrows as rules.",
        "Add a second diagram showing how one module could later be extracted into a separate service and what would change.",
        "Specify the payload schema and delivery guarantee (outbox pattern) for two of your domain events.",
      ],
      repoChecklist: [
        "Exported diagram image (PNG or SVG) committed to the repo",
        "README or docs/architecture.md with the written explanation and the four traced flows",
        "A table listing every port, its owner module, and its adapters",
      ],
      relatedLessons: ["layered-clean-architecture", "solid-principles", "dependency-injection"],
    },
    {
      slug: "modular-erp-core",
      title: "Capstone: The Modular ERP Core",
      kind: "capstone",
      summary:
        "Rebuild ERP invoicing and inventory with strict ports and adapters so that PostgreSQL and MongoDB are swappable via one configuration value.",
      estimatedHours: 30,
      needsDiagram: true,
      designPrompt:
        "Draw a ports-and-adapters (hexagonal) architecture diagram of the ERP core: the Inventory and Invoicing modules with their domain and application layers at the center; driving adapters (HTTP API, tests) on one side; driven ports (repositories, UnitOfWork, InvoiceNumberSequence, InvoiceQueries) on the other, each with both its PostgreSQL and MongoDB adapters; and the composition root showing the single PERSISTENCE config switch that selects which adapter set is wired in. Show import directions, and mark where transaction boundaries and tenant scoping are enforced.",
      requirements: [
        "Domain and application code import no infrastructure packages (pg, Prisma/Drizzle/Knex, mongodb/mongoose, express), enforced by an automated check in CI or a lint script.",
        "All business rules are implemented: reservations, gap-free per-tenant yearly invoice numbering, status transitions, and half-even rounded tax with no floating-point money.",
        "Complete PostgreSQL and MongoDB adapters exist, each with its own Unit of Work, and pass the same parameterized repository contract test suite, which also runs against the in-memory fakes used by the use-case tests.",
        "Switching providers requires only changing the PERSISTENCE configuration value; the end-to-end flow passes on both.",
        "IssueInvoice is atomic on both providers: a forced mid-operation failure leaves stock, reservations and invoice status unchanged.",
        "A concurrency test shows no overselling and unique, gap-free invoice numbers under parallel requests.",
        "Cross-tenant access by ID is rejected for reads and writes, verified by tests.",
        "Every use case has unit tests (happy path plus at least one rule violation) that run against in-memory fakes injected through constructors, in under 2 seconds total, without any database.",
      ],
      hints: [
        "Build the domain and use cases first with in-memory repositories and a trivial in-memory UnitOfWork. Do not write any database code until the business tests pass.",
        "Model Money as integer minor units plus a currency, with explicit multiply and round-half-even helpers; test rounding edge cases like 0.005.",
        "Write the repository contract tests as a function that takes a factory (makeRepos) so the same suite runs against the in-memory, Postgres and Mongo implementations.",
        "Gap-free numbering needs a per-tenant per-year counter row/document incremented inside the issuing transaction (UPDATE ... RETURNING or SELECT ... FOR UPDATE in Postgres, findOneAndUpdate with $inc inside a session in Mongo). Postgres sequences are not gap-free, because nextval() is never rolled back.",
        "Mongo multi-document transactions require a replica set; run a single-node replica set in docker compose (mongod --replSet rs0 plus rs.initiate()).",
      ],
      rubric: [
        "If you deleted the mongo/ adapter folders and the one config branch, would anything else fail to compile?",
        "Are invariants enforced inside domain objects rather than in use cases or adapters?",
        "Do your contract tests cover the edge cases (not found, tenant mismatch, concurrent updates) and not just the happy path?",
        "Is every transaction boundary owned by a use case through the UnitOfWork port?",
        "Could a reviewer understand the architecture from your diagram and README alone in 10 minutes?",
        "Where did you choose pragmatism over purity (for example read-side queries), and did you document why?",
      ],
      stretchGoals: [
        "Add a third adapter (SQLite or an event-sourced store) to prove the ports are truly provider-agnostic.",
        "Publish InvoiceIssued domain events via a transactional outbox, processed by a worker with its own composition root.",
        "Expose an OpenAPI spec and generate the HTTP DTO types from it.",
        "Add optimistic locking with a version field on aggregates and a test that demonstrates a rejected stale write.",
      ],
      repoChecklist: [
        "README with architecture overview, docker compose setup, and how to run the app and tests with each provider",
        "Exported architecture diagram (PNG or SVG) showing ports, both adapters and the composition root switch",
        "Use-case unit tests with in-memory fakes (npm test, no database), plus one repository contract suite run against in-memory, Postgres and Mongo, and atomicity, concurrency and tenant-isolation tests, each runnable via an npm script",
        "docker-compose.yml for Postgres and a Mongo replica set",
        "Boundary enforcement config (dependency-cruiser or ESLint) wired into a CI workflow or npm lint script",
        "A short ADR (architecture decision record) explaining key trade-offs",
      ],
      relatedLessons: [
        "layered-clean-architecture",
        "repository-pattern",
        "dependency-injection",
        "testing-from-day-one",
        "solid-principles",
      ],
    },
  ],
  sources: [
    {
      label: "Clean Code by Robert C. Martin",
      url: "https://www.oreilly.com/library/view/clean-code-a/9780136083238/",
      kind: "book",
    },
    {
      label: "Refactoring.Guru",
      url: "https://refactoring.guru",
      kind: "interactive",
    },
  ],
};
