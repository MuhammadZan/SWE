## What a strong solution looks like

A strong submission turns one 30-line handler into four small pieces that each have one reason to change. The route handler only parses the request shape, calls `CreateUser`, and maps results and errors to HTTP. `CreateUser` holds the business decisions (email uniqueness, seat limit, password policy, default role) and talks to the world only through three ports it owns: `UserRepository`, `SeatPolicy` and `PasswordHasher`. All SQL lives in one infrastructure class with explicit mapping functions. A composition root wires the real implementations, and swapping in an in-memory repository is a one-line change there.

The proof is in the tests. Use-case tests read like a specification ("rejects a duplicate email in the same tenant", "allows the same email in another tenant", "rejects the eleventh user on a 10-seat plan") and pass with Docker stopped. An integration test runs the real repository against Postgres and checks mapping, tenant filtering and soft-delete handling. One HTTP-level test proves the response body has no `password_hash` or `passwordHash` key.

The legacy behavior is preserved: the same four status codes for the same inputs. Ideally the refactor also closes the duplicate-email race with a partial unique index, mapping error `23505` to the same 409.

## Reference approach

**Domain.** `Email` is a value object, so normalization can't be forgotten:

```ts
export class Email {
  private constructor(readonly value: string) {}
  static parse(raw: string): Email {
    const v = raw.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new ValidationError("Invalid email");
    return new Email(v);
  }
}
```

**Ports** (in `application/`, owned by the use case):

```ts
export interface UserRepository {
  findByEmail(tenantId: string, email: Email): Promise<User | null>;
  countActive(tenantId: string): Promise<number>;
  add(user: User): Promise<void>;
}
export interface SeatPolicy { seatLimit(tenantId: string): Promise<number> }
export interface PasswordHasher { hash(plain: string): Promise<string> }
export interface IdGenerator { next(): string }
```

**Use case.** The password rule is business policy, so it moves here, not into the HTTP schema:

```ts
export class CreateUser {
  constructor(
    private readonly users: UserRepository,
    private readonly seats: SeatPolicy,
    private readonly hasher: PasswordHasher,
    private readonly ids: IdGenerator,
  ) {}

  async execute(cmd: { tenantId: string; email: string; name: string; password: string; role?: Role }) {
    const email = Email.parse(cmd.email);
    if (cmd.password.length < 10) throw new ValidationError("Weak password");
    if (await this.users.findByEmail(cmd.tenantId, email)) throw new ConflictError("Email already in use");
    const [count, limit] = await Promise.all([this.users.countActive(cmd.tenantId), this.seats.seatLimit(cmd.tenantId)]);
    if (count >= limit) throw new SeatLimitError();
    const user = User.create({ id: this.ids.next(), tenantId: cmd.tenantId, email, name: cmd.name,
      role: cmd.role ?? "member", passwordHash: await this.hasher.hash(cmd.password) });
    await this.users.add(user);
    return user;
  }
}
```

**HTTP layer.** One mapping function, and a DTO that whitelists fields:

```ts
const statusFor = (e: unknown) =>
  e instanceof ValidationError ? 400 : e instanceof SeatLimitError ? 402 : e instanceof ConflictError ? 409 : 500;

const toUserDto = (u: User) => ({ id: u.id, email: u.email.value, name: u.name, role: u.role });
```

**Repository.** `toDomain`/`toRow` are the only places that know column names. Every query includes `tenant_id = $1` and `deleted_at IS NULL`. `add` catches `23505` and throws `ConflictError`.

**Tests.** A use-case test with fakes:

```ts
it("rejects a user beyond the plan's seat limit", async () => {
  const users = new InMemoryUserRepository();
  await seedUsers(users, "t1", 3);
  const create = new CreateUser(users, { seatLimit: async () => 3 }, fakeHasher, sequentialIds());
  await expect(create.execute({ tenantId: "t1", email: "new@acme.io", name: "N", password: "long-enough-pw" }))
    .rejects.toThrow(SeatLimitError);
});
```

`fakeHasher` returns `"hashed:" + plain`, which keeps tests fast (bcrypt at cost 12 takes around 200 ms per call) and lets you assert the hash was stored without exposing it.

## Common mistakes

- **The interface lives in infrastructure** next to the Postgres class, so the use case imports from `infrastructure/`. The arrow points the wrong way.
- **Validation split badly.** All rules in zod in the handler means the CSV importer or an admin script can bypass the password policy. Shape validation belongs in HTTP. Business rules belong in the use case or domain.
- **Returning the domain object or row directly.** `res.json(user)` serializes every field, including `passwordHash`. A DTO function is an explicit whitelist.
- **Mocking `pg` in unit tests** instead of faking the port. Those tests check SQL strings, not business behavior, and break on every query tweak.
- **No tenant isolation test.** The same email in a different tenant must succeed. Many submissions forget the tenant filter in `findByEmail` and never notice, because their tests only ever use one tenant.
- **Constructing dependencies inside the use case** (`new BcryptHasher()`), which brings back the hidden-dependency problem.
- **Ignoring the race.** Two parallel requests can both pass the read-then-write check. Without a unique index, you can still get duplicate users.

## Trade-offs worth discussing

- **Where does the seat check live?** A `SeatPolicy` port keeps the accounts module independent of the billing schema. Querying `plans` directly from the user repository is simpler, but couples two modules through a join. Either is defensible if justified.
- **The seat-limit race.** Counting then inserting can exceed the limit under concurrency. Fixes include `SELECT ... FOR UPDATE` on the subscription row inside a transaction, a counter column with a check constraint, or accepting a rare overrun and reconciling. Interviewers like hearing that you noticed it.
- **Class versus function style.** `makeCreateUser(deps)` closures are equally valid DI. Consistency across the codebase matters more than the choice.
- **Is the pattern worth it here?** For one endpoint, arguably not. The payoff comes when the same rules serve an invite flow, SCIM provisioning and an admin import.
- **ID generation.** Generating UUIDs in the application (`IdGenerator` port) instead of with `gen_random_uuid()` lets the use case know the ID before saving and makes tests deterministic.

## Grade yourself

| Dimension | Strong | Acceptable | Needs work |
|---|---|---|---|
| Layer boundaries | Lint or dependency-cruiser fails CI when `application/` imports `infrastructure/` or `pg`; grep finds SQL only in one file | Boundaries clean by inspection, no automated check | Use case imports the DB client or repository class directly |
| Use-case tests | 6+ fast tests with fakes covering success, 400, 409, 402, cross-tenant email reuse and no hash leak; pass with Docker stopped | 3–5 tests, happy path plus one or two failures | No unit tests, or tests that need a database |
| Integration test | Real Postgres via compose or Testcontainers, migrations applied, tables truncated per test, covers mapping and tenant filter | One happy-path repository test against a real DB | None, or only against a mocked client |
| HTTP behavior | Same four status codes as legacy, central error mapper, explicit DTO, test asserting no hash field | Correct codes, DTO, but mapping scattered across handlers | Raw row or domain object returned |
| Composition root | Single `container.ts`; switching to the in-memory repository changes one line | Wiring centralized but with a few `new` calls elsewhere | Concrete classes constructed throughout |
| Concurrency | Partial unique index plus `23505` mapped to 409, with a test | Unique index present, but a raw 500 on conflict | Read-then-write check only |

## Going further

1. Extract a repository contract suite and run it against both `InMemoryUserRepository` and the Postgres implementation, then add soft delete and prove that deleted users neither count toward seats nor block email reuse.
2. Add an `InviteUser` use case that reuses `UserRepository` and `SeatPolicy` without duplicating any rule, and see how much the separation pays off.
3. Add Postgres Row-Level Security on `users` keyed by a `app.tenant_id` setting as defense in depth behind the repository's tenant filter.
