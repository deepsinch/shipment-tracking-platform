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

## Live updates without a replay log, and the race hiding in "re-fetch on reconnect"

**Problem.** Dashboards, the shipment page and the driver app update without reloads. The design
(decisions 15–16) treats realtime messages as invalidations: services `pg_notify` inside their
transaction, one `LISTEN` connection per server instance fans out to SSE streams, and clients
re-fetch rather than replaying an event log. The hidden race: the browser's EventSource `open`
event only means the HTTP response started. The server's `LISTEN` may not be active yet, so a change
committed in that gap is never announced, and a client that re-fetched on `open` would never learn
about it.

**Options considered.**

- Re-fetch on `open`: racy, as above.
- Make the route wait for `LISTEN` before responding: needs a timeout and an error path, and
  EventSource treats a non-200 response as fatal (no automatic reconnect).
- Replay a log with `Last-Event-ID`: contradicts the invalidation design and adds state.
- **Chosen:** the bus itself sends `resync` to each subscriber once its subscription is live, and
  again after every listener reconnect. Clients re-fetch (and show "Live") only on that event. It
  closes the race with no new state.

**Isolation.** Each message is checked against the viewer (organization, and for drivers their
current or previous assignment) and projected to a client shape with no organization or user ids.
Tests prove a stream never receives another organization's event using a sentinel: Postgres
delivers notifications in commit order, so once a later event has arrived, an earlier one would have
too. Proving absence without sleeping is otherwise impossible.

**Hosting.** `LISTEN` needs a direct connection (transaction poolers do not support it). Streams
close themselves at 270 s, under the 300 s function limit, and reconnect. A refresh is deferred
while a form has unsaved input, with a "Show latest" prompt instead of wiping what someone typed.

## A live map that mixes server renders and client events

**Problem.** Marker positions arrive as live events in the browser, but which shipments exist and
their status change on the server. Two sources of truth meet in one component.

**Options considered.**

- A snapshot endpoint the map re-fetches on resync: a second data path to authorize and test, and it
  duplicates the coalescing and hidden-page logic the live refresh already has.
- Copy the server snapshot into client state once: later server refreshes silently stop reaching it.
- Re-fetch on every position event: wasteful at one event per vehicle every 10 seconds.
- **Chosen:** derive the markers on every render as `mergeFleet(snapshotProp, liveFixes)`. The
  snapshot decides which shipments exist; live fixes only move them, and the newest device time wins
  in either order. The page refreshes only for structural changes (a status change, or the first ping
  of a shipment the snapshot does not have yet). The merge is a pure, unit-tested function, and an
  end-to-end test proves markers move, appear and disappear without a reload.

**Accessibility.** The map is supplementary: a list beside it carries the same information, and
keyboard users reach every marker's link from there. Marker easing respects `prefers-reduced-motion`.

**Gotcha worth telling.** CSS applies the individual `scale` property before `transform`, so a hover
scale on a MapLibre marker scaled its positioning translation and the marker jumped about 40 px
away from the pointer, making it unclickable. The effect now lives on an inner element.

**Cost.** MapLibre is about 290 KB gzipped and loads only on the two pages with a map, after
hydration; no other page downloads it, and it never runs on the server.

## A demo simulator that obeys every rule

**Problem.** A portfolio demo should look alive when someone opens it: trucks moving along real
roads, statuses advancing, the occasional problem. A simulator that wrote to the database directly
would be quick to build, but it could produce states the real app would reject.

**Approach** ([`src/server/simulator/`](../src/server/simulator/)): `pnpm simulate` acts as each
truck's assigned driver and goes through the real services only (`recordLocationPing`,
`changeShipmentStatus`), so every rule, throttle, history entry and realtime message applies. Routes
are OpenStreetMap road geometry fetched once from OSRM and committed as a 60 KB fixture, so there is
no runtime dependency on a public routing server. The planner (route interpolation, next action) is
pure and tested over whole routes against the state machine; the script is thin wiring that re-reads
status and version every tick and re-plans when a service refuses an action.

**Interesting bug.** The simulator first remembered "this exception is mine to clear" in memory. A
restart, or a `--once` run, then treated its own exception as an office hold and left the shipment
stuck forever.

- Marking simulator exceptions with special note text: fragile, and it leaks into customer text.
- A new table for simulator state: extra schema for a demo tool.
- Clearing every exception: overrides real office holds.
- **Chosen:** read ownership from the append-only history each tick. If the truck's driver
  recorded the exception, the driver clears it; otherwise it waits for the office. It mirrors real
  ownership, survives restarts and needs no new state.

## A public API on top of services built for sessions

**Problem.** Every service takes an `AuthContext` built from a signed-in member. An API key has no
member behind it, yet it must obey exactly the same rules (tenant scope, status rules, concurrency)
without a fake role leaking into the auth library or the UI.

**Approach.** A widened `ActorRole` (`member roles | "api"`) on `AuthContext`, and a narrower
`MemberAuthContext` for everything session-based. The compiler forces every permission function and
its test to decide what `api` may do (a dispatcher's permissions). Keys are 32 random bytes shown
once; only a SHA-256 hash is stored and looked up through a unique index, so the secret is never
compared and needs no constant-time check.

**Concurrency over HTTP.** `ETag` is the shipment version, and status changes require `If-Match`:
`428` without it, `412` with the current ETag when it is stale. It is the same lost-update guarantee
the dashboard forms have, proven with the same forced-race test over real HTTP: exactly one request
gets `200`, the other `412`, and one history event is written.

**Options rejected.** Adding `api` as a member role (it would become assignable in the UI); a
parallel permission model for keys (two sets of rules that drift). The OpenAPI document is
hand-written, with tests tying it to the route files and response projections so it cannot drift.

## Webhooks on serverless: no worker, no double delivery, no SSRF

**Problem.** Customers register URLs to hear about shipment changes. Deliveries must never be
invented (a rolled-back change), lost (a crash mid-send) or duplicated by two concurrent drains, and
the free hosting plan has no background worker and only a daily cron.

**Approach.**

- An outbox row is written in the same transaction as the change, so a delivery exists only if the
  change committed.
- The first attempt runs right after the response via Next's `after()`; retries are drained by app
  and API activity behind a 30-second global throttle, with the daily cron as a backstop.
- A drain claims due rows in a short transaction with `FOR UPDATE SKIP LOCKED`, counts the attempt
  and sets a 2-minute lease, then sends with no transaction open. Concurrent drains skip each other's
  rows; a crashed drain's row comes back after the lease.
- Signatures are HMAC-SHA256 over `timestamp.body` with a 5-minute replay window; receivers verify
  with the snippet in `docs/api.md`.

**SSRF and DNS rebinding.** Checking a URL when it is saved is not enough: the name can later
resolve to an internal address. At every delivery the host is resolved, every returned address is
classified (private, loopback, link-local, CGNAT, metadata, including IPv4 embedded in IPv6), and the
connection is pinned to the vetted address through a custom `lookup`, so there is no second DNS query
to rebind. Redirects are never followed.

**Options rejected.** One long transaction per batch (holds locks across slow HTTP calls); advisory
locks (no per-row visibility); a claim `UPDATE` without `SKIP LOCKED` (drains queue on the same rows).
At scale the outbox feeds a hosted queue instead of activity-driven drains.

## Customer email without double sends or leaked staff notes

**Problem.** Customers get an email on key status changes. A retry, a duplicate enqueue or the
provider's own retry must never produce two emails, staff-only notes must never reach a customer,
and an unsubscribe must hold even for an email already queued.

**Approach.** The message is rendered and stored inside the status change's transaction, so staff see
exactly what the customer got and a rolled-back change sends nothing. The template's input type has
no internal-note field, so a caller cannot leak one by accident. Each email has an idempotency key
derived from the history event id (unique index, and sent to Resend as `Idempotency-Key`), so every
retry is the same email. Opt-outs are per organization and address and are checked at queue time and
again at send time. Unsubscribe links carry an HMAC-signed token, and the link opens a confirm page
whose button posts, so mail scanners that follow links cannot unsubscribe anyone.

**Without a key, and in the demo.** Without Resend credentials, and always in demo mode, messages go
to a stored preview that admins can read, so the whole flow is demonstrable without sending real
email to addresses visitors typed.

## Proof of delivery, and a CSP test that caught a bundling bug

**Problem.** Drivers capture a printed name, a drawn signature and an optional photo on delivery.
Proof must be atomic with the "delivered" event, photos must be private and free of location data,
and a public demo must never store visitor files.

**Approach.** The proof row is written in the same transaction as the status change (an append-only
table, like history); the photo uploads first and is deleted again if the transaction does not
commit. Signatures are compact vector strokes, rendered as SVG in React. Photos are accepted as JPEG
or PNG by magic bytes, stripped of EXIF/XMP server-side by walking file segments (no dependency), and
streamed to staff through an authenticated route, so the storage key never reaches a browser and the
CSP needs no new origin. The printed name is the proof, so keyboard users can complete a delivery
without drawing. The public page and webhooks only learn "signed by <name>".

**Bug story.** After the first UI commit the CSP end-to-end test failed on the driver pages with a
blocked `eval`. The signature pad imported a constant from a module that also imported Zod, and
Zod 4 probes `new Function` when it loads. Rather than loosening the CSP, the client-side constants
moved to a schema-free module, and "no Zod in client bundles" became a project rule. A CSP test that
runs on every surface is what turned a silent risk into a red build.

## An LLM feature that cannot book, leak or invent

**Problem.** Dispatchers paste a customer's shipment request email and get a prefilled booking form.
The email is untrusted input to a language model: a hostile email could try to make the feature act,
exfiltrate data, or slip invented values into a booking.

**Approach.** Structured output with no tools (a tool is an action surface), and a system prompt
that treats the email as data placed between random per-request markers. The server then treats the
model's answer as untrusted too: unknown keys are dropped, units and countries are normalized, every
value must pass the same field rules as manual booking, and values that cannot be paraphrased
(email, reference, postal code) must literally appear in the email or they are dropped as invented.
The result is an editable draft; only a person can book it, through the normal path. Calls are capped
per organization per day (and globally in the demo) with the existing Postgres counters, counted
before the model call so failures cost quota too.

**Honest limit.** This stops invented and invalid values, not values the attacker's own text
supplies: if an injected email contains an address, a misled model could put it in the draft. Human
review is the final control, and a test states that limit explicitly.

**Evaluation.** Eight fixtures (English, German, French, one prompt injection, one with missing
fields) run through the validation layer in CI with recorded answers; `pnpm intake:eval` measures
field-level accuracy against the live model when a key is configured.

**Measure, fix, re-measure.** The first live run scored 110/112: the model turned "same day please"
into a delivery time and kept a shop name in the pickup address. Both traced to underspecified rules
in the prompt (a service level is not a date; address lines are street and number only). After
tightening them, the re-run scored 112/112.

## A flaky test that was a real bug

**Problem.** One end-to-end test failed about one run in four and passed on re-run. Re-running CI made
it go away, which is exactly how flaky tests hide product bugs.

**Approach.** Reproduce first: `--repeat-each=30` failed 8 times. Timestamped logs of the refresh
scheduler showed the cause was not the suspected late echo of the user's own change, but the
`resync` every live connection sends on (re)connect. If the user touched a form in the ~300 ms
before that refresh fired, they saw "this shipment was updated while you were editing" when nothing
had changed. That happens to real users on every page load and every routine reconnect, not just in
tests.

**Fix.** Distinguish "maybe stale" from "known changed": a `resync` blocked by unsaved input now
waits silently and refreshes once the input is gone; only an actual change event can show the
notice. Unit tests cover both paths (three fail against the old scheduler). The repeat run then
exposed a second, latent flake: end-to-end sign-ins shared one client address and tripped the real
sign-in rate limit, fixed by giving each test client its own address. Final result: 50 of 50 runs
pass.

**Lesson.** A flaky test is a bug report with bad reproduction steps. Reproduce it under repetition,
instrument the timing, and fix whichever side has the race: here it was the product.
