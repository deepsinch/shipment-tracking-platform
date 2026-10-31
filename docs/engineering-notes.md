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

## Proving optimistic concurrency actually works

**Problem.** Two people change the same shipment at once. Status changes use optimistic concurrency:
the update says `WHERE id = ? AND version = ?` and bumps the version, so the second writer matches no
rows and gets a conflict with fresh data
([`change-shipment-status.ts`](../src/server/services/change-shipment-status.ts)). The hard part is
proving it. Firing two requests with `Promise.all` is a race: if one finishes before the other
starts, an early "is your form stale?" check rejects the second, and the test passes even with the
real guard deleted.

**Options considered.**

- `Promise.all`: flaky, and cannot tell which mechanism caught the conflict.
- A test-only pause hook inside the service: leaks test code into production code.
- `SERIALIZABLE` isolation with retries: changes the design under test.
- Advisory locks: also need cooperation from the code under test.
- **Chosen:** a third transaction locks the row with `SELECT ... FOR UPDATE`, the test waits until
  `pg_stat_activity` shows both changes blocked on that lock, then releases it. Both have certainly
  passed the early check and are queued on the `UPDATE`. Under READ COMMITTED, Postgres re-checks
  `version = expected` against the newly committed row, so exactly one wins, one gets a conflict,
  and exactly one history event is written. Deterministic, with no changes to the service.

**Proof the test can fail.** Removing `version = expected` from the `UPDATE` turns it red.

**Related decisions.**

- The early version check stays, as a fast path that answers stale forms before validating the
  transition ("someone else changed this" is more useful than "invalid transition").
- Tracking-code collisions retry with `INSERT ... ON CONFLICT DO NOTHING RETURNING`, because a failed
  statement aborts the whole Postgres transaction; the alternatives were retrying the whole
  transaction or a savepoint per attempt.
- Every read and write builds on one `visibleShipments(ctx)` condition (organization, plus "assigned
  to me" for drivers), so the scope cannot be forgotten in one query. Removing the organization
  filter fails seven tests.

**At scale.** The same pattern works across services and APIs by exposing the version as an ETag
and requiring `If-Match` on updates (HTTP 412 on conflict), which is the plan for the public API.

## What the user sees when they lose a race

**Problem.** Optimistic concurrency rejects a stale update, but rejecting is only half the job. The
user who lost needs to see what changed and retry safely, without retyping their notes.

**Approach** ([`actions.ts`](../src/app/dashboard/shipments/actions.ts),
[`status-change-form.tsx`](../src/app/dashboard/shipments/[id]/status-change-form.tsx)): on a
conflict the Server Action returns a message plus the user's typed values and revalidates the page.
The server re-renders the fresh shipment and history, and the form is keyed on `version`, so it
remounts with the new expected version and only the transitions valid from the new status. The
user's notes survive; a status that is no longer valid resets to "Choose a status".

**Options considered.**

- Patch the UI on the client from the conflict payload: duplicates server rendering, and the history
  would still be stale.
- `router.refresh()` from the client: an extra round trip and more client logic.
- Silently retry with the new version: a lost update in disguise.
- Pessimistic locking: cannot span the time a person spends thinking.

**Proof.** An end-to-end test drives two tabs: the stale tab's update is rejected, it shows the
other user's change, and the retry succeeds. Removing the revalidation makes the test fail.

## Rate limiting sign-in on serverless hosting

**Problem.** Sign-in had no brute-force protection: Better Auth's limiter only covers its HTTP
handler, and the app's Server Actions call its API directly. On serverless hosting many short-lived
instances run at once, so the limit has to be shared.

**Approach** ([`rate-limit.ts`](../src/server/auth/rate-limit.ts),
[`sign-in.ts`](../src/server/auth/sign-in.ts)): fixed-window counters in Postgres, one atomic
`INSERT ... ON CONFLICT DO UPDATE` per attempt, where a `CASE` either restarts an expired window or
increments the count.

- Attempts are counted before the password check, so parallel guessing cannot outrun the counter
  and an unknown email gets the same answer as a wrong password. A test fires 8 parallel attempts at
  a limit of 3 and exactly 3 get through.
- Limits: 5 per email+IP per 15 minutes (cleared by a successful sign-in), 30 per IP per 15 minutes,
  10 sign-ups per IP per hour.
- Keys are SHA-256 hashes, so the table never stores emails or IP addresses in clear.

**Options considered.**

- In-memory map: resets on every cold start and each instance allows the full limit.
- Redis/Upstash: ideal at scale, but another service to run for a small product.
- Sliding window: more state, to avoid at most 2x the limit at a window boundary.
- Count only after a failure: concurrent requests all slip past the check.
- Route sign-in through Better Auth's handler: loses the no-JavaScript Server Action form flow.

**Known tradeoff.** Keying the account limit on email + IP means a botnet rotating IPs still gets a
few guesses per IP. A per-email limit stops that but lets anyone lock a victim out of their account;
the planned answer is a looser per-email cap plus breached-password checks.

## Sending each role to its own home right after sign-in

**Problem.** Drivers belong on `/driver` and staff on `/dashboard`, decided at the moment of
sign-in. But sign-in runs in a Server Action, and the auth library sets the new session cookie on the
response, so the usual "who is signed in?" helper (which reads the request) cannot see the session
in that same request.

**Options considered.**

- Redirect everyone to `/dashboard` and let its guard bounce drivers: works, but an extra hop and a
  flash of the wrong page.
- A `/home` route that only redirects: the same extra hop, plus a route that exists for plumbing.
- Replay the response's `Set-Cookie` into a second session lookup: fragile next to the library's own
  cookie handling.
- Re-derive the role from the user's oldest membership: duplicates the session hook's rule, which
  could drift.
- **Chosen:** read the session row the hook just wrote, by its token, and run the same
  `resolveAuthContext` every request uses. Exact (the same organization and role the session will
  have), one indexed query, covered by an integration test.

**Related.** Wrong-surface visits (a driver opening `/dashboard`) redirect server-side inside the
page's Suspense boundary. A role-aware `proxy.ts` would be faster, but it needs the role in the
cookie, which conflicts with reading roles fresh on every request (decision 8).

## Throttling location pings without a race

**Problem.** Drivers' phones send positions, and the server should accept at most one per shipment
every 10 seconds, even when two arrive at the same moment (two tabs, a retry, a flaky network).

**Approach** ([`record-location-ping.ts`](../src/server/services/record-location-ping.ts)): one
conditional upsert on `shipment_positions` is both the check and the write:
`INSERT ... ON CONFLICT (shipment_id) DO UPDATE ... WHERE updated_at <= now - 10s RETURNING`.
Postgres serializes concurrent upserts of the same row and re-checks the `WHERE` against the
committed row, so exactly one ping wins; the ping history row is inserted only if a row came back.
Out-of-order pings are stored but do not move the position (a per-column `CASE` keeps the newer
fix), and a `FOR SHARE` lock on the shipment makes a concurrent status change wait, so a ping is
never accepted for a shipment delivered mid-flight.

**Options considered.**

- Read the last ping, then write: races. A burst of 5 parallel pings passed against it anyway,
  because the transactions are so short; only a forced race (hold the row lock until both requests
  are blocked) exposed the bug. Bursts are not proof.
- A per-shipment advisory lock: an extra round trip and easy to forget at a new call site.
- Redis rate limiter: another service to run.
- A max-over-pings query: slow on a growing table, and still racy.

**Telemetry is not history.** Pings live in their own tables (decision 13). They reject `UPDATE`
like history does, but allow `DELETE` so the 30-day retention purge can run.
