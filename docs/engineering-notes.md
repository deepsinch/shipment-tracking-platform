# Engineering notes

Deep dives into the problems in Waybill worth discussing: what made each one hard, what we chose,
what we rejected, and what would change at scale. The design itself is in
[architecture.md](./architecture.md); this document is about the reasoning.

## Shipment status as a state machine

**Problem.** A status column lets any code set any value: a shipment could jump from `created` to
`delivered`, or come back from `cancelled`. The UI also needs to know which actions to offer.

**Approach.** The transition table lives in one pure module,
[`src/domain/shipment-status.ts`](../src/domain/shipment-status.ts). The UI calls
`allowedNextStatuses()` to render only valid actions; the server calls `canTransition()` and rejects
everything else. Terminal states are derived (no outgoing transitions), not listed separately.

**Tradeoffs.**

- Database check constraints validate values, not transitions. A trigger could validate transitions,
  but the rules would then live in two languages. One module, tested, is simpler.
- The tests restate the transition table independently and check every pair of statuses, so an
  accidental edit to the table fails loudly instead of silently allowing a new path.

**At scale.** Per-customer workflows (e.g. a "customs hold" status for international carriers) would
move the table from code into data, with the same `canTransition` interface.

**Likely questions.** Why not a library like XState? (Seven states and a flat table do not need one;
it would add a dependency and a learning curve for no new capability.)

## Unguessable tracking codes

**Problem.** Customers see the shipment's code on a public page with no login. Sequential ids can be
enumerated; UUIDs are hostile to read over the phone or type on a mobile keyboard.

**Approach.** `WB-XXXX-XXXX` in Crockford base32, generated in
[`src/domain/tracking-code.ts`](../src/domain/tracking-code.ts):

- Exactly 5 random bytes (40 bits) become exactly 8 base32 symbols, so there is no modulo bias.
- The alphabet drops I, L, O and U. Input is normalized: case, spaces and dashes are ignored and
  look-alikes are mapped (I and L read as 1, O as 0), so a code read aloud still works.
- Plain number arithmetic instead of BigInt: 40 bits is far below 2^53, and it compiles under
  Next.js's default ES2017 target.
- A unique index plus retry handles the rare collision.

**Tradeoffs.** 40 bits is about 1.1 trillion codes. With a million live shipments a random guess hits
about 1 in a million; rate limiting the public page closes the gap. Longer codes are harder to read
aloud.

**At scale.** Lengthen the code, or require a second factor (destination postcode) to see full
details.

## Building on a framework newer than the docs you remember

**Problem.** The project uses Next.js 16.4, whose defaults differ from the versions most tutorials
(and AI models) know: Cache Components is on, middleware is now `proxy.ts`, and typed route props
such as `LayoutProps` only exist after a code-generation step.

**Approach.** Build against the docs that ship inside the installed package
(`node_modules/next/dist/docs/`) rather than memory. Two concrete results:

- `pnpm typecheck` runs `next typegen` before `tsc`, otherwise a fresh clone fails with
  "Cannot find name LayoutProps".
- With Cache Components, reading cookies, headers, `params` or `searchParams` outside a `<Suspense>`
  boundary is a build error. Dynamic pages get a `loading.tsx` and layouts stream the session in;
  this was planned before writing auth code, not discovered as a build failure.

**Tradeoffs.** Turning Cache Components off would have meant familiar patterns, but it is the
direction the framework is going, and static shells with streamed dynamic parts are faster for users.

## Making history impossible to rewrite

**Problem.** The audit trail is only trustworthy if nothing can change it: not a bug, not a script,
not a careless migration.

**Approach.** A Postgres trigger rejects `UPDATE` and `DELETE` on `shipment_events`
([migration 0001](../src/server/db/migrations/0001_append_only_shipment_events.sql)). Two quieter
paths needed their own answers:

- `TRUNCATE` does not fire row-level triggers, so a statement-level trigger blocks it too.
- Cascading deletes and `SET NULL` are themselves `DELETE`/`UPDATE` statements on history. Every
  foreign key into history is `restrict`, which turns this into an explicit rule: anything with
  history is deactivated, never deleted. Better Auth's organization deletion is disabled for the
  same reason.

**Testing.** Integration tests run against a real Postgres that is wiped and re-migrated each run.
Mocks and in-memory emulators (pg-mem) do not run plpgsql triggers; Testcontainers needs Docker. To
prove the tests can fail, the trigger was swapped for a no-op and four tests went red. Because tests
cannot delete history, each one uses random ids, and setup refuses any database not named `*_test`.

**At scale.** The app should connect as a role that does not own the tables, so even compromised
application code cannot drop the trigger. Partition `shipment_events` by month once it grows.

## Tenant isolation enforced by the database, not just the code

**Problem.** Every query filters by organization, but application code can have bugs. An event
recorded against one company's shipment with another company's id would corrupt both timelines.

**Approach.** A composite foreign key: `shipment_events (shipment_id, organization_id)` references
`shipments (id, organization_id)`, so an event can only belong to its shipment's organization.
CHECK constraints guard value ranges (positive weight, valid coordinates, two-letter country codes).
They complement Zod validation, which gives users friendly messages; the database is the last line.

**Gotcha.** drizzle-kit generated the composite FK before the unique constraint it depends on, and
Postgres rejected it. The migration was reordered by hand, with a comment explaining why.

**At scale.** Postgres row-level security as a second layer, so a forgotten `WHERE organization_id`
returns nothing instead of another tenant's rows.

## Sign-up that lands you in your own organization

**Problem.** Better Auth sessions carry an "active organization". After sign-up, the new user must
land in the organization just created for them.

**Options considered.**

- Auto sign-in, then set the active organization. The new session cookie only exists in the
  response, so a follow-up server call cannot use it without extra token plumbing.
- Put the organization id in the cookie or a JWT. The role would go stale until the token expires.
- **Chosen:** create the user, create the organization server-side, then sign in. A session-creation
  hook sets the user's membership as the active organization, so every later sign-in works the same
  way with no special case.

The role is read from the membership row on every request, so demoting or removing someone takes
effect immediately.

**Surprise.** With auto sign-in off, Better Auth answers a duplicate email with a fake success (to
prevent account enumeration) and stores nothing. An integration test caught the resulting crash;
reading the library source explained it. The code now confirms the user exists.

**Known tradeoffs.**

- The sign-up form says when an email is taken: friendlier, but it reveals which emails have
  accounts. Revisit with email verification.
- User and organization creation cannot share a transaction (Better Auth owns both tables), so a
  failed organization step deletes the user again (compensation).
- Better Auth's rate limiter does not cover server-side API calls, so sign-in needs its own limiter
  (tracked in implementation notes).
