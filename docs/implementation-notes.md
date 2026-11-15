# Implementation notes

Handoff log for whoever continues the work. Update it at the end of every phase and whenever you
learn something a newcomer would trip over. Design rationale lives in `docs/architecture.md`.

## Current status

**Phase 1 (core) is complete on branch `phase-1-core`** (checkpoint 6 reached). format:check,
lint, typecheck, test (74 unit + 97 integration), build and test:e2e (3 specs) pass.

Phase 1 delivered, checkpoint by checkpoint:

1. Scaffold and tooling (Next.js 16, TypeScript strict, ESLint, Prettier, Vitest).
2. Database: Drizzle schema, committed migrations, append-only `shipment_events` trigger, tenant FK
   and CHECK constraints, real-Postgres integration tests.
3. Auth: Better Auth with organizations and roles, `AuthContext`, layered guards.
4. Services with result unions: create, list, get, change status (state machine + optimistic
   concurrency + event in one transaction), public tracking projection.
5. UI: landing, auth pages, dashboard list, create, detail with status changes and conflict
   handling, public tracking page; Playwright e2e against a dedicated database; README.
6. Demo seed (`pnpm db:seed`), sign-in/sign-up rate limiting, Phase 1 docs.

**Phase 2 (live tracking) is complete on branch `phase-2-live-tracking`** (checkpoint 5 reached).
format:check, lint, typecheck, test (212 unit + 188 integration), build and test:e2e (13 specs)
pass. **Next: Phase 4a (deployment), before Phase 3**, on branch `phase-4a-deploy` (the owner chose a live
demo URL first). Design: `docs/architecture.md`, "Phase 4a: deployment". Checkpoint 1 is done
(as-built notes under "CI and hardening (Phase 4a, checkpoint 1)" below). Checkpoint 2 is done
too (notes under "Deploy pipeline and demo mode (Phase 4a, checkpoint 2)"): format:check, lint,
typecheck, test (283 unit + 208 integration), build and test:e2e (21 specs) pass. **Phase 4a is
code-complete; what remains is the owner's deploy** (`docs/deployment.md`) and putting the live
URL in the README.
Checkpoints:

1. **[done] CI and hardening.** GitHub Actions workflow (Postgres service, all six checks, Playwright's own
   Chromium in CI), runtime env validation with Zod (lazy, clear messages), security headers incl.
   CSP for OpenFreeMap, `robots.txt`.
2. **[done] Deploy pipeline and demo mode.** `vercel-build` (validate, migrate on the direct URL, idempotent
   seed, build), `DATABASE_URL_UNPOOLED` mapping, `vercel.json` cron, demo banner and one-click
   demo sign-in, `/api/cron/reset-demo`, globally throttled `/api/demo/tick`, and a click-by-click
   deployment guide for the owner (`docs/deployment.md`).

**Now: Phase 3** on branch `phase-3-integrations` (checkpoints under "Next: Phase 3"; design in `docs/architecture.md`, "Phase 3: integrations"), then the rest of Phase 4. Phase 2 delivered, checkpoint
by checkpoint (design and as-built notes in `docs/architecture.md`, "Phase 2: live tracking"):

1. **[done] Driver app and reassignment.** `/driver` (mobile-first, assigned shipments, big-button status
   flow via `statusOptionsFor`), role-based landing after sign-in, `assignDriver` service with a
   `driver_assigned` event, and the public timeline restricted to customer-facing event types by an
   allow-list (with a test). E2E: a driver signs in, lands on `/driver`, advances a shipment.
2. **[done] Location pings.** `location_pings` + `shipment_positions` (migration 0005 with
   composite FKs and CHECKs), `recordLocationPing` (driver-only, assigned-only, on-the-road
   statuses, 10 s throttle, future-time rejection, late pings don't move the position),
   `getShipmentPositions` (snapshot for the map), and "Share my location" in the driver app. Also
   in this checkpoint: a confirm step before delivered/cancelled in both surfaces, and seed
   deadlines that are mostly on time.
3. **[done] Realtime.** `RealtimeBus` with the Postgres `LISTEN`/`pg_notify` implementation on
   `DATABASE_DIRECT_URL`, `pg_notify` inside status, assignment and ping transactions, an SSE route
   handler with auth and org/driver filtering, self-closing before the function time limit, and
   client hooks that `router.refresh()` or update positions. Integration tests: notifications only
   on commit, cross-org isolation on the stream. Also: a Live indicator in both headers and the
   staff detail page's live "Last seen" line.
4. **[done] Live map.** MapLibre GL 6 + OpenFreeMap "positron", client-only (`next/dynamic`,
   `ssr: false`). `/dashboard/map` (a view next to the list, shareable URL): a marker per
   unfinished shipment with a position, coloured by status tone, popups, a list of links beside
   the map, live moves with a short ease. The detail page has a small route map (pickup, delivery,
   straight `LineString`, live position marker). The seed gives the demo driver's unfinished
   shipments a last position. E2E with tiles blocked.
5. **[done] Truck simulator.** OSRM road routes for the seed's 29 city pairs (committed fixture,
   `pnpm routes:fetch`), drawn solid on the detail map (straight dashed line otherwise), and
   `pnpm simulate`, which drives the demo trucks through `recordLocationPing` and
   `changeShipmentStatus` only (pure planner + thin wiring, unit and integration tested). The Phase 2
   acceptance e2e (a driver advances a shipment, the dispatcher's page updates without a reload) is
   `tests/e2e/realtime.spec.ts` ("the dispatcher's detail page follows the driver's updates without
   a reload"), with the list (`… booking made in another tab …`) and the map
   (`live-map.spec.ts`) covered alongside; not duplicated.

## Phase 4b: polish (complete)

One checkpoint on `phase-4b-polish`. format:check, lint, typecheck, test (740 unit + 435
integration), build and test:e2e (41 tests) pass.

- **Mobile navigation.** `src/components/dashboard-nav.tsx`: the header links from `sm` up; below,
  a menu button opens a side sheet (Radix dialog: focus trap, Escape, focus returns to the button).
  Both mark the current page with `aria-current="page"`. The server still decides which links a role
  sees (`navItems` in the dashboard layout).
- **Accessibility.** `tests/e2e/accessibility.spec.ts` runs axe (WCAG A/AA and best-practice rules,
  fails on serious and critical) on landing, sign-in, sign-up, dashboard, detail, live map (tiles
  blocked), settings pages, driver list and shipment, public tracking, and the open mobile menu. It
  found one real issue: the destructive colour on its 10 % tint was below 4.5:1 (darkened in
  `globals.css`). No rule is disabled. Gotcha: axe checks the page as rendered, so run it after the
  content is visible (a heading assertion first), not right after `goto`.
- **Lighthouse** (13, mobile, local production build, not a CI gate): landing 96/100/100/100, sign-in
  100/100/100/63, tracking 93/100/100/54. The two lower SEO scores are the `noindex` on those pages
  (`is-crawlable`, and a tracking page's missing description), on purpose. Remaining performance
  findings are framework JS (unused JS, legacy JS in Next's runtime); nothing app-specific worth
  chasing. Re-run instructions are in the README.
- **Retention.** `purgeExpiredData` also deletes `webhook_deliveries` and `email_messages` in a final
  state (`succeeded`, `dead`, plus `suppressed` for emails) created more than 90 days ago; open rows are
  never deleted. Delivery proofs and `shipment_events` are kept on purpose: the proof is the evidence of
  who received the goods and the history is the audit trail, so a retention period is the operator's
  legal decision. Integration tests cover both cutoffs, kept and deleted rows.
- **Coverage.** `pnpm test:coverage` (v8, source files; components and pages excluded as they are
  covered by e2e): 88 % lines, 84 % branches.
- **README** rewritten as a front page, with screenshots in `docs/screenshots/` (taken with real
  tiles against the seeded dev database; about 380 KB). To retake them, seed with `--reset`, run a
  production build and use Playwright with the preinstalled Chromium.
- `tests/e2e/api-keys.spec.ts` had a flaky "No API keys yet" locator (a hidden copy of the previous
  route matched in strict mode); it now asks for the visible one.

Final known gaps: see "Known issues / TODOs" below (the CSP allows inline scripts; one organization
per user; no per-organization time zones; the adapters for Resend, Blob and Anthropic have only been
exercised against fakes; location pings are purged but the index on `received_at` is still missing).

### If I continued

- Real-provider smoke tests run by hand once per key (Resend, Blob, `pnpm intake:eval`), then a small
  post-deploy check in CI.
- Nonce- or hash-based CSP once Cache Components supports it, removing inline script allowance.
- Per-organization time zones, member management UI (invite, change role, deactivate) and an
  organization switcher.
- Geocoding at booking so UI-created shipments appear on the map and in the simulator.
- Marker clustering and a revocation signal for open realtime streams at fleet scale.
- A per-email sign-in cap with breached-password checks, and email verification at sign-up.
- A retention index on `location_pings (received_at)` and a configurable retention for delivery
  proofs once a legal basis is chosen.
- A proper queue (or Vercel Queues) for webhooks and email instead of drains on activity plus a
  daily cron.

## Next: Phase 3

Each checkpoint green and reviewed, like Phase 2. Suggested order (later ones build on earlier):

1. **[done] Public API with API keys.** `api_keys` table (migration 0007: hashed key, display
   prefix, organization, scopes with CHECKs, creator, last used, revoked), key services, admin UI
   at `/dashboard/settings/api-keys` (shown once, revoke with confirm), route handlers under
   `/api/v1` (list, get, create shipments; change status; public tracking) over the existing
   services with an `api` `AuthContext`. Explicit projections with key-set tests, RFC 9457 errors,
   per-key and per-IP rate limits (decision 11's counters), `ETag` = shipment version and
   `If-Match` required on status changes (`412` / `428`), a hand-written OpenAPI 3.1 document at
   `/api/v1/openapi.json`, and `docs/api.md`. Design and decisions 53 to 57 in
   `docs/architecture.md`.
2. **[done] Signed, retried webhooks.** Endpoints per organization (URL, secret, event types), an outbox
   table written in the same transaction as the change (like `pg_notify` today), a delivery worker
   with exponential backoff and a dead-letter state, HMAC-SHA256 signatures with a timestamp
   (replay window), a delivery log in the UI with "resend". Decide where the worker runs (Vercel Cron
   or a queue) before building.
3. **[done] Email notifications via Resend.** Customer emails on chosen status changes (recipient email
   already stored), from the same outbox; templates with the public tracking link; idempotency key
   per event; unsubscribe link; test mode without a key in development.
4. **[done] Proof of delivery.** Printed name (required), drawn signature (optional, vector strokes) and
   photo (optional, private Vercel Blob) captured in the driver app's delivery sheet, written with the
   `delivered` event in one transaction (`delivery_proofs`, migration 0010, append-only). Replaces the
   confirm step for drivers' deliveries; staff can still mark a delivery from the office (confirm
   dialog, recorded as no proof). The public page, webhook and email say who signed, nothing more.
5. **[done] AI intake of shipment request emails.** "Paste a request email" on the new-shipment page
   (admins and dispatchers, only with `ANTHROPIC_API_KEY`): the model's structured answer is checked
   field by field against `createShipmentSchema`'s rules and prefills the normal form as a draft; a
   person books it. Daily caps on the Postgres counters, eight fixtures, `pnpm intake:eval` for the
   live model.

**Phase 3 is complete** (public API, webhooks, email, proof of delivery, AI intake). Known gaps
across the phase, none blocking: no retention or erasure for delivery proofs and photos (decision 70);
webhook deliveries and emails in a final state are purged after 90 days (Phase 4b); webhook retries and emails wait for
activity or the daily cron on a quiet Hobby deployment; the delivery log and the email status on
the shipment page do not update live; the Resend, Vercel Blob and Anthropic adapters have only been
exercised against local fakes and mocked SDKs (the owner should send one real email, deliver once
with a photo and run `pnpm intake:eval` after adding each key); intake has no inbound-email
webhook, no attachments and no batch of several shipments.

## Roadmap

- **Phase 2 (done):** driver app, location pings, live map (MapLibre + OpenStreetMap), realtime
  via SSE, truck simulator. Checkpoints above.
- **Phase 3:** public API with API keys, signed and retried webhooks, email notifications via Resend,
  proof of delivery (photo + signature), AI intake of shipment request emails.
- **Phase 4 (done):** CI with GitHub Actions and the deploy to Vercel + Neon (4a); mobile navigation,
  accessibility (axe e2e) and Lighthouse pass, retention, coverage and the README front page (4b).

## Decisions and gotchas so far

- **Tracking codes** (approved by the architect):
  - `generateTrackingCode()` draws 5 random bytes = exactly 40 bits = exactly 8 Crockford symbols,
    so there is no modulo bias.
  - It uses plain number arithmetic, not BigInt: Next's default tsconfig targets ES2017, where BigInt
    literals do not compile. 40 bits is well below 2^53, so numbers are exact.
  - `normalizeTrackingCode()` ignores case, spaces and dashes, **requires** the `WB` prefix (so an
    arbitrary 8-character string is not treated as a code), and maps look-alikes I/L to 1 and O to 0.
    U is always invalid. Returns `null` on invalid input.
- **State machine:** the transition table lives only in `shipment-status.ts`. The tests restate it
  independently and check every status pair, so an accidental edit fails loudly.
- **Labels:** human labels come from `SHIPMENT_STATUS_LABELS` / `shipmentStatusLabel`; use them in the UI.

### Installed versions (checkpoint 1)

Next 16.4.3, React 19.3.0, TypeScript 5.9.3, Tailwind CSS 4.3.3 (via `@tailwindcss/turbopack`),
ESLint 9 + eslint-config-next 16.4.3, Prettier 3.9, Vitest 5.0.5 (Vite 8), better-auth 1.7.14,
drizzle-orm 0.45.4, drizzle-kit 0.31.11, pg 8.23, zod 4.6.7, @playwright/test 1.64.1, tsx 4.23.

- Own-write window: the realtime echo of a submit from this tab arrives before the Server Action's revalidated page remounts the (version-keyed) form, which still holds the submitted values. `LiveRefresh` therefore treats a guarded form's `submit` as an own write: realtime requests are queued (never a notice) until the form leaves the DOM plus a 3 s grace (10 s cap if it never remounts), and a MutationObserver re-checks a shown notice so it clears when the form becomes clean. React cancels the native submit of action forms, so do not test `defaultPrevented` on it. `tests/e2e/own-submit.spec.ts` guards this.
- Resync is not a change: every realtime connection starts with a `resync`, which on a fresh page load arrives ~300 ms after the page and fires a (debounced) refresh. If the user had already touched a guarded field, that refresh was blocked and the "updated while you were editing" notice appeared for an update that never happened (this was the flake in `own-submit.spec.ts`: ~25% of runs, always at the first check, notice visible for ~150 ms until the submit dismissed it). `LiveRefresh` now passes `request("resync")`; the scheduler waits silently for the input to go (or the submit's own revalidation), and only a `shipment_changed` request raises the notice. Reproduce with `pnpm exec playwright test tests/e2e/own-submit.spec.ts --repeat-each=30`. Still theoretical: a _late_ own echo (after the 3 s grace) while the user is typing in the fresh form would still raise the notice; closing that needs the shipment version on realtime events.
- E2E sign-ins need their own client address too: `signIn` (like `signUp`) sets a random `x-forwarded-for` on the context, otherwise all sign-ins share the machine's address and hit the 30 per 15 minutes limit (a 50x repeat run, or three passes of the suite, would time out on the driver sign-in).

### Library gotchas

- **Next 16 is newer than most training data.** It ships its own docs in
  `node_modules/next/dist/docs/`; read those instead of relying on memory. `next dev` maintains a
  managed block in `AGENTS.md`; it is committed so the tree stays clean.
- **Cache Components is on by default** in the scaffold (`cacheComponents: true`, plus
  `partialPrefetching: true`). Reading `cookies()`, `headers()`, `params` or `searchParams` outside a
  `<Suspense>` boundary is a build error. Pages that read request data need a `loading.tsx` (or an
  explicit `<Suspense>`), and layouts must push session reads into a component inside a boundary.
  See `node_modules/next/dist/docs/01-app/02-guides/authentication-with-cache-components.md`.
- **Middleware is now `proxy.ts`** (`export function proxy(request)`), same functionality.
- **Typed route props:** `LayoutProps<"/">` / `PageProps<"/x/[id]">` are global types generated by
  `next typegen`. The `typecheck` script runs `next typegen` before `tsc --noEmit`, otherwise a clean
  checkout fails to typecheck.
- **Vite 8 resolves tsconfig paths natively** (`resolve.tsconfigPaths: true`), so
  `vite-tsconfig-paths` is not needed.
- **pnpm 10 blocks dependency build scripts.** esbuild/sharp/unrs-resolver are listed under
  `ignoredBuiltDependencies` in `pnpm-workspace.yaml`; esbuild gets its binary from an optional
  platform package, so nothing breaks (tsx and Vitest run fine).
- **Better Auth CLI** is the `auth` npm package (`pnpm dlx auth@<version> generate`), not
  `@better-auth/cli` (stale at 1.4.x).
- **shadcn/ui registry** (`ui.shadcn.com`) is reachable from this environment.
- **Better Auth schema is generated, never hand-edited.** `pnpm auth:generate` runs the CLI against
  `src/server/auth/auth-schema.config.ts` (schema-relevant options only, no database adapter, so the
  CLI does not have to load the DB client) with `--adapter drizzle --dialect postgresql`, then
  Prettier. Re-running it on an unchanged config reproduces `src/server/db/schema/auth.ts` exactly.
  If a plugin that adds tables is enabled (teams, dynamic access control), add it to that config,
  regenerate, then `pnpm db:generate`.
- **Better Auth uses `timestamp` without time zone** for its own tables. Left as generated; our tables
  use `timestamptz` (`withTimezone: true`).
- **drizzle-kit resolves the `@/` tsconfig alias** when loading the schema, so schema files can
  import enum values from `src/domain`.
- **Custom SQL migrations:** `pnpm db:generate --custom --name <name>` creates an empty, journaled
  file. Separate statements with `--> statement-breakpoint`.
- **Drizzle wraps driver errors.** The Postgres SQLSTATE is on `error.cause.code`, not `error.code`;
  `pgErrorCode()` in `tests/integration/fixtures.ts` unwraps it.
- **FK actions vs the append-only trigger.** Postgres runs FK `ON DELETE CASCADE` / `SET NULL` as
  ordinary DELETE/UPDATE statements, which fire the trigger. So every FK on `shipment_events` (and
  `shipments.organization_id`) is `restrict`: deleting a user/org/shipment that has history fails
  cleanly with an FK error. Deactivate instead of deleting (Better Auth org deletion should be
  disabled in checkpoint 3).
- **`server-only` in tests and scripts.** Importing it outside a React Server Components bundle
  throws. Vitest aliases it to `tests/server-only-stub.ts`; tsx scripts (seed) should run with
  `--conditions=react-server` or avoid importing server-only modules.
- **`"type": "module"`** is set in `package.json`, otherwise Vite warns that `vitest.config.ts` is
  ESM loaded as CommonJS (and the Better Auth CLI warns the same about its config).

- **drizzle-kit can emit a composite FK before the unique constraint it references** (seen in
  0002), which Postgres rejects. Read generated SQL; reorder by hand if needed (commented in 0002).
- **DB client is lazy:** use `getDb()`, there is no module-level `db`. The client is created on first
  call and cached on `globalThis`. The Better Auth instance is lazy the same way (`getAuth()`).

### Auth (checkpoint 3)

- **Layout:** `src/server/auth/options.ts` holds everything schema-relevant (email/password options
  and the organization plugin with `ac`/`roles`); `auth.ts` (runtime, adds the Drizzle adapter, the
  session hook and `nextCookies`) and `auth-schema.config.ts` (CLI) both spread it.
  `pnpm auth:generate` rewrites `schema/auth.ts` byte-identically.
- **Active organization:** a `databaseHooks.session.create.before` hook sets the session's
  `activeOrganizationId` to the user's oldest membership. Sign-up therefore creates the org first and
  signs in afterwards (`autoSignIn: false`).
- **Gotcha: with `autoSignIn: false`, Better Auth returns a synthetic success for an existing email**
  (fake user id, `token: null`, nothing stored) to prevent account enumeration. `signUpWithOrganization`
  checks the returned id exists before creating an org. Our form does tell the user the email is
  taken: a deliberate B2B UX choice; Better Auth's rate limiter (on in production) limits probing.
- **Role** comes from the `member` row on every request (`resolveAuthContext`), not the session.
- **Guards:** `proxy.ts` only checks a session cookie exists (optimistic). The real check is
  `requireAuthContext()` in the dashboard layout (inside `<Suspense>`), in each page, and (from
  checkpoint 4) at every service entry point via the `AuthContext` argument. A forged cookie passes
  the proxy and is rejected by the server check (verified manually).
- **Gotcha: React 19 resets uncontrolled forms after a Server Action completes.** Failed submissions
  must echo the non-secret values back for `defaultValue`, or the user retypes everything.
- **Gotcha for e2e: Next 16 keeps the previous route mounted but hidden** after client navigation
  (state preservation), so `page.locator("main")` can match two elements. Target visible, specific
  content (headings, labels). Next's route announcer also has `role="alert"`, so don't select error
  messages by role alone.
- **Testing auth without a browser:** `auth.api.signInEmail({ body, returnHeaders: true })` returns
  the `Set-Cookie` headers; turn them into a `cookie` request header for `auth.api.getSession`.
  `nextCookies()` is safe outside a request (it catches the missing request scope).

### Services (checkpoint 4)

- **Layout:** one file per use case in `src/server/services/`, each with an `*.integration.test.ts`
  next to it. Shared pieces: `results.ts` (result unions, `fieldErrorsOf`), `validation.ts` (Zod
  helpers for form strings), `shipment-access.ts` (`visibleShipments(ctx)`, the tenant + driver scope).
  Role rules are pure in `src/domain/shipment-permissions.ts`.
- **Services take `input: unknown`** and parse it with Zod, like `signUpWithOrganization`. Schemas
  coerce numbers and dates (forms and URL params send strings) and treat blank optional fields as
  absent, so checkpoint 5 can pass `Object.fromEntries(formData)` almost directly. For
  `changeShipmentStatus`, `location` is nested (`location.city`, `location.lat`, `location.lng`);
  field errors use dotted keys for it.
- **Drivers see only assigned shipments everywhere** (list, get, change), not just in
  `changeShipmentStatus`. Out of scope is always `not_found`; only `createShipment` returns
  `forbidden` for drivers.
- **Malformed UUIDs are `not_found`**, checked before querying; otherwise Postgres raises `22P02`
  on the uuid cast.
- **Conflict results carry `current`** (the fresh row) so the UI can show what changed.
- **Gotcha: a failed statement aborts a Postgres transaction.** That is why the tracking code retry
  uses `ON CONFLICT (tracking_code) DO NOTHING RETURNING` (no row = collision) instead of catching
  `23505`. `createShipment` takes an optional `deps.generateTrackingCode` for the collision test.
- **Gotcha: concurrency tests are racy unless forced.** The concurrency test holds the shipment row
  with `SELECT ... FOR UPDATE` in a third transaction, waits until `pg_stat_activity` shows two
  backends blocked on a lock, then commits. Both changes have then provably passed the version
  pre-check, so the test exercises the guarded `UPDATE` (removing `version = expected` from it turns
  the test red; verified). Integration files run serially, so no other test holds locks meanwhile.
- **Proven-red checks (checkpoint 4):** removing the version guard (1 test red), removing the org
  filter from `visibleShipments` (7 red), removing the driver filter (3 red), adding `internalNote`
  to the public timeline (3 red). All restored.
- **Public tracking timeline includes `status`** (the status each event entered), beyond the
  type/time/city/note in the original brief: `type` alone ("status_changed") is meaningless to a
  customer.
- `getShipment` left-joins `user` for actor and driver names (checkpoint 5b).
- Reference search is `ILIKE '%term%'`, which no index serves; fine at small-carrier scale within
  one organization's rows. A `pg_trgm` index is the fix if it ever matters.

### UI (checkpoint 5a)

- **shadcn CLI needs the NO_PROXY workaround** (`pnpm dlx shadcn@4.23.0 ...` fails with ENOTFOUND
  otherwise). Add components with `pnpm dlx shadcn@4.23.0 add <name>`, then run Prettier
  (generated files have no semicolons).
- **Generated components import `cn` from the `cn` package** (shadcn's own clsx + tailwind-merge
  replacement, repo `shadcn-ui/cn`); `src/lib/utils.ts` re-exports it. `shadcn` is a runtime
  dependency because `globals.css` imports `shadcn/tailwind.css`.
- **Theme font:** the theme maps `--font-sans` to itself, so the Geist font in `layout.tsx` must
  set the CSS variable `--font-sans` (it was `--font-geist-sans`).
- **Form errors:** use `FieldShell` / `TextField` from `src/components/form-field.tsx`, not shadcn's
  `FieldError`, which puts `role="alert"` on every field. Fields get `aria-invalid` and
  `aria-describedby`; the form shows one `FormAlert` (`data-testid="form-alert"`, role alert).
- **Dates** render in UTC with a "UTC" label (`src/lib/format.ts`); per-org time zones are later.
- Filters are a plain GET form, so the list works without JavaScript and URLs are shareable.
- The dev database `waybill` has a throwaway org from a visual check (`visual-*@example.test`,
  password `password123`, 24 rows); harmless, wiped by any reseed.

### UI and e2e (checkpoint 5b)

- **Server Action files (`"use server"`) may only export async functions.** Constants such as the
  form field list stay module-private; types are fine (erased).
- **Status form and conflicts:** `useActionState` lives in `StatusChangeForm`, above the `<form>`,
  and the form is keyed by `version`. On `conflict` the action calls `revalidatePath`, the page
  re-renders with the fresh shipment, the form remounts on the new version (hidden
  `expectedVersion`), and the message plus the echoed notes survive in the action state. If the
  chosen status is no longer offered, the select falls back to "Choose a status". Without the
  `revalidatePath` the stale tab keeps old data (verified: the conflict e2e goes red).
- **`datetime-local` has no time zone.** The UI shows UTC, so the actions append `Z`
  (`dateTimeLocalAsUtc` in `src/lib/form-data.ts`); otherwise the server's zone would apply.
- **Forms use `noValidate`** so the service's messages (one source of truth) show instead of the
  browser's bubbles; `required` stays for `aria-required`.
- **Not-found after streaming:** dynamic pages have a `loading.tsx`, so `notFound()` runs after the
  stream started and the response is a 200 with `noindex` (Next documents this). Acceptable for
  these pages; a proxy check would be needed for a real 404 status.
- **`generateMetadata` and the page share one lookup** via React `cache()` (detail and track pages).
- **Playwright starts `webServer` before `globalSetup`.** So database preparation is the first step
  of the web server command (`tsx tests/e2e/prepare-database.ts && next build && next start`),
  which guarantees it finishes before the app starts. `reuseExistingServer` is off so a server on
  another database is never reused. The e2e app runs on :3100 with `BETTER_AUTH_URL` to match.
- **e2e database:** `E2E_DATABASE_URL` (in `.env`, see `.env.example`); the name must end in `_e2e`.
  It is created on first run (the `waybill` role has `CREATEDB`), then wiped and migrated every
  run. The reset code is shared with the integration setup (`src/server/db/maintenance.ts`, also used by `db:seed --reset`).
- **e2e locators:** `getByRole` / `getByLabel` skip the hidden previous route; fieldsets give the
  two address blocks a `group` role (scope "Country code" to `Pickup` / `Delivery`). Form messages
  use `data-testid` (`form-alert`, `form-status`) because of the route announcer's role alert.
- **Killing a background server:** `pkill -f "next start"` also matches the shell running it and
  ends the command; find the PID by port instead (`ss` is not installed in every container; if
  you started it as a background task, stop that task).

### Seed and rate limiting (checkpoint 6)

- **Seed through the services.** `seedDemo` (`src/server/seed/demo-seed.ts`) creates users with
  Better Auth (`signUpWithOrganization` for the admin, `signUpEmail` + `addMember` for the others),
  books shipments with `createShipment(ctx, input, { now })` (the injectable clock backdates the
  booking) and replays history with `changeShipmentStatus` using backdated `occurredAt`. So the
  state machine, role rules (drivers record their own shipments, the office cancels) and event
  ordering are enforced exactly as in the app. A deterministic PRNG keeps the data stable.
- **Re-runs:** a no-op once `admin@demo.test` exists (history cannot be deleted, so nothing is
  refreshed). `pnpm db:seed --reset` wipes and re-migrates first and refuses any database not
  named `waybill`. The reset helpers live in `src/server/db/maintenance.ts` (tooling only).
- **`tsx --conditions=react-server`** makes `server-only` resolve to its empty export, so the seed
  script can import services. Better Auth calls work outside a request (`nextCookies` is a no-op).
- **Rate limits** (`src/server/auth/rate-limit.ts`): fixed windows in `auth_rate_limits`, one
  atomic `INSERT ... ON CONFLICT DO UPDATE` per attempt. Attempts are counted **before** the
  password check, so concurrent guesses cannot outrun the counter and unknown emails behave like
  wrong passwords. A successful sign-in clears the per-account count only. Tests inject `now`;
  Better Auth itself still uses real time.
- **e2e and sign-up limits:** sign-up allows 10 per IP per hour, and every e2e run starts from a
  wiped database, so the e2e sign-ups never hit it. Manual testing against the dev DB can; wait,
  or `DELETE FROM auth_rate_limits`.

### Driver app and reassignment (Phase 2, checkpoint 1)

- **Role-based landing.** `homePathFor(role)` (`src/domain/role-home.ts`) is the one rule.
  `signIn` returns the new session's `AuthContext`, resolved from the `session` row by its token:
  the session cookie set by `nextCookies` only reaches the browser with the response, so
  `getAuthContext()` (which reads request headers) cannot see it inside the same action.
- **Surface guards.** `requireAuthContextOn("/dashboard" | "/driver")` in `session.ts` runs in each
  surface's layout and every page, and redirects to the role's home. `proxy.ts` now also matches
  `/driver/:path*`, still only checking that a cookie exists.
- **Gotcha: those redirects happen after streaming starts** (the guard runs inside `<Suspense>`),
  so Next performs them client-side. The browser shows the skeleton briefly and the HTTP status is 200. In e2e, assert with `await expect(page).toHaveURL(...)` (it waits), never `page.url()`.
- **Status action is shared** by both surfaces: `src/app/_actions/change-status.ts`. Forms send
  only the fields they have (missing fields read as blank) and it revalidates both surfaces' paths.
  The driver form's buttons are `type="submit" name="toStatus" value=...`; React includes the
  submitter in the action's `FormData`, and `useFormStatus().data` tells which button is pending.
- **Shared UI:** `ShipmentHistory` (`src/components/shipment-history.tsx`, also names driver
  changes) and `ActionMessage` (`form-status` / `form-alert` test ids).
- **`assignDriver` bumps `version`** (a stale assignment or status form becomes a conflict), writes
  a `driver_assigned` event with `metadata: { fromDriverId, toDriverId }`, and refuses delivered
  and cancelled shipments (`closed`, see `canChangeDriver`). Assigning the current driver again is
  a validation error, so every event records a real change. The initial assignment at booking is
  part of the `created` event, not a separate `driver_assigned` event.
- **The status-change ordering check ignores events without a status.** `latestStatusEventTime`
  filters on `to_status IS NOT NULL`, so a driver can still backdate a pickup that happened before
  the office assigned them (test in `assign-driver.integration.test.ts`).
- **Public allow-list:** `PUBLIC_SHIPMENT_EVENT_TYPES` in `src/domain/shipment-event.ts`, applied
  as `inArray` in `getPublicTracking`. The domain test restates the list on purpose.
- **`listAssignedShipments`** adds "assigned to me" to `visibleShipments`, so it stays personal for
  any role. Finished shipments are ordered by `updated_at` (set by Drizzle's `$onUpdate` on every
  service update).
- **Gotcha: `ALTER TYPE ... ADD VALUE` (migration 0004).** Postgres refuses to _use_ a new enum
  value in the transaction that added it, and the Drizzle migrator applies all pending migrations
  in one transaction. A later migration that references `'driver_assigned'` (a CHECK, a backfill)
  would fail on a fresh database. Cast through text or ship it in a separate release.
- **E2E drivers:** there is no member management UI, so `addDriver()` in `tests/e2e/helpers.ts`
  runs `tests/e2e/add-driver.ts` with `tsx --conditions=react-server` against `E2E_DATABASE_URL`.
  It uses Better Auth (`signUpEmail` + `addMember`) like the seed. The assignment itself goes
  through the reassign UI.
- **Proven-red checks (checkpoint 1):** in `assignDriver`, removing the role check (1 test red),
  the driver membership check (4 red), or `visibleShipments` (1 red); removing the public
  `inArray` allow-list (2 red); removing `visibleShipments` from `listAssignedShipments` (1 red).
  All restored.
- **Visual check** (Playwright screenshots, 390 px and 1280 px, seeded dev data). Two fixes came
  out of it. On the staff detail page, the taller side column (status plus driver card) stretched
  grid row 1 and left a gap above History; `lg:grid-rows-[auto_1fr]` fixed it. On the driver app,
  shipments past their promised time now read "Overdue" in red (words and colour).

### Location pings, confirm step, seed (Phase 2, checkpoint 2)

- **Throttle = one conditional upsert.** `recordLocationPing` runs
  `INSERT INTO shipment_positions ... ON CONFLICT (shipment_id) DO UPDATE ... WHERE updated_at <=
now - 10 s RETURNING`; no row back means throttled, and only then is the ping inserted (same
  transaction). `shipment_positions.updated_at` is therefore "server time of the last accepted
  ping", and it moves even for a late ping that leaves the position alone. Concurrent upserts of
  one row serialize on the row (or on the speculative insert for a brand-new row), and Postgres
  re-evaluates the WHERE against the committed row, so two parallel pings can never both win.
  Decision 20 in the architecture doc.
- **Gotcha: a burst test does not prove race safety.** Five parallel pings on a fresh shipment pass
  even with a naive read-then-write throttle, because each transaction commits before the next one
  reads. The deterministic test holds the position row `FOR UPDATE` in a third transaction until
  both pings are blocked on it (same technique as the status concurrency test); that one goes red
  with read-then-write (verified).
- **Late pings:** `CASE WHEN excluded.recorded_at >= shipment_positions.recorded_at` per column, so
  the newest device time wins (ties go to the later arrival) and `positionMoved` is simply
  "returned `recorded_at` equals the ping's".
- **`FOR SHARE` on the shipment row** while a ping is stored: a concurrent status change waits for
  the ping to commit, so a ping can never land after the shipment was delivered. Pings do not
  block each other on it.
- **The server clock is injectable** (`deps.now`), like `createShipment`, so tests step past the
  throttle window without sleeping. `received_at` and `updated_at` come from it, not `now()`.
- **`location_pings` rejects UPDATE but allows DELETE/TRUNCATE** (trigger in 0005): pings are
  telemetry with a 30-day retention, so the purge must be able to delete; a recorded fix is never
  corrected. Retention itself is Phase 4.
- **Gotcha: `z.coerce.number()` turns `null` into 0** (a valid latitude). Ping coordinates use
  plain `z.number()`: pings come from code, not form strings. `recordedAt` accepts a `Date` or an
  ISO string, and invalid dates fail.
- **Snapshot includes `exception`.** `getShipmentPositions` returns every unfinished shipment with
  a position (pings stop during an exception, but its last position is what dispatch wants then);
  delivered and cancelled drop off. Built on `visibleShipments`, joined on `(id, organization_id)`.
- **Pings go through a Server Action** (`src/app/driver/actions.ts`), not a route handler: only our
  own component calls it, and it gets the session, Next's origin check and typed arguments for free.
  The public API (Phase 3) would add a route handler over the same service.
- **Client logic is framework-free** (`src/lib/location-sharer.ts`, unit tested with fake timers
  and a fake Geolocation): sends the newest fix at most every 10 s, queues a fix that arrives
  inside the window, retries a throttled fix once in the next window (found in the visual check:
  with a fixed fake position, a throttled first ping left the status on "sending…"), stops for
  permission denied and server stops, and keeps trying on unavailable/timeouts.
- **Gotcha: Next hides, not unmounts, routes you leave** (Activity). Effects clean up, but state
  survives. The component stops sharing and resets its switch in a `useLayoutEffect` cleanup (the
  pattern in `node_modules/next/dist/docs/01-app/02-guides/preserving-ui-state.md`), so coming back
  never resumes sharing without a new tap. The confirm dialog resets the same way.
- **Accessible status:** the "Sharing location · last sent 12 s ago" line ticks every second, so it
  is the switch's `aria-describedby`, not a live region; a separate `sr-only` `role="status"`
  announces state changes only.
- **Playwright geolocation:** `context.grantPermissions(["geolocation"])` plus
  `context.setGeolocation(...)`. There is no position UI until the map, so the spec reads the
  stored row with `tests/e2e/read-position.ts` (read-only, refuses non-`_e2e` databases).
- **Confirm step** (`src/components/terminal-status-confirmation.tsx`): the form's `onSubmit` reads
  the status being submitted (`new FormData(form, submitter)`), and for a terminal one calls
  `preventDefault()`, which also stops React's form action (checked in react-dom: the action only
  runs when the submit event was not default-prevented), and opens a Radix alert dialog. The
  confirm button is portalled outside the form, so it uses the `form` attribute and a
  `data-confirmed` marker the guard lets through; in the driver app it also carries
  `name="toStatus"`. UI-only by design (a slip guard, not a trust boundary); without JavaScript the
  form submits directly.
- **Gotcha: `shadcn add alert-dialog` asks to overwrite `button.tsx`** and hangs without a TTY.
  Answer no: `yes n | pnpm dlx shadcn@4.23.0 add alert-dialog` (with the NO_PROXY workaround).
- **Seed deadlines:** unfinished shipments are promised relative to the seed's `now` (17:00 UTC,
  at least 2 h ahead, plus the service level's days), except `OVERDUE_SHIPMENTS` (indices 12 and
  26, both the demo driver's), due 2-3 hours ago. Finished shipments keep the booking-relative
  promise. The smoke test pins "exactly 2 overdue" (the old logic gave 8).
- **Proven-red checks (checkpoint 2):** in `recordLocationPing`, removing the throttle `WHERE`
  (3 red), a read-then-write throttle (1 red: the forced race), removing `visibleShipments` (2 red),
  the role check (2 red), the status rule (4 red), the late-ping `CASE` (1 red). In
  `getShipmentPositions`, removing `visibleShipments` (3 red), keeping only the org filter (1 red:
  driver scope), removing the terminal filter (1 red). Disabling the `location_pings` UPDATE
  trigger (1 red); removing the confirm guard (both confirmation e2e specs red); the old seed
  deadline logic (1 red). All restored.
- **Visual check** (Playwright, 390 px and 1280 px): driver Location card off and sharing, the
  driver's delivery confirmation, the dashboard's cancellation confirmation. Fixes from it: the
  throttled-fix retry above, and the unchecked switch (light grey on white, below 3:1 contrast) now
  uses `muted-foreground/80`.

### Realtime (Phase 2, checkpoint 3)

- **Layout.** `src/server/realtime/`: `messages.ts` (Zod union, encode/decode, 8000-byte check),
  `bus.ts` (interface and signals), `postgres-bus.ts`, `index.ts` (`getRealtimeBus()`, lazy and
  cached on `globalThis` like the pool), `visibility.ts` (pure filter and client projection),
  `sse-stream.ts`. Services publish through `src/server/services/realtime-signals.ts`. Route:
  `src/app/api/realtime/route.ts`. Client: `src/lib/realtime-connection.ts`,
  `refresh-scheduler.ts`, `unsaved-input.ts`, `realtime-events.ts` (framework-free, unit tested),
  and `src/components/realtime/` (provider, `useRealtime`, `LiveIndicator`, `LiveRefresh`,
  `useLivePosition`). Design and decisions 23-26 in the architecture doc.
- **`DATABASE_DIRECT_URL`** (empty locally, falls back to `DATABASE_URL`). Vitest and the
  Playwright web server set it explicitly to their own databases, so a value in `.env` can never
  point a test listener at the dev database (live updates would silently never arrive).
- **Gotcha: the browser's `open` is not "listening".** The response can start before the bus's
  `LISTEN` is active. Clients resync on the server's first `resync` event instead, which the bus
  sends only once the subscription is live. Tests wait for it too before producing events.
- **Gotcha: proving absence needs a sentinel.** "Org A never receives org B's event" is asserted
  after a later org A event (the sentinel) arrives: notifications are delivered in commit order
  over one connection and the stream preserves order. `recordRealtime().flush()` in
  `tests/integration/realtime.ts` does the same for bus-level tests.
- **Route tests use real sessions.** `route.integration.test.ts` signs users up through Better Auth,
  turns `Set-Cookie` into a `cookie` header and calls `GET(new Request(...))`. This works because the
  handler reads `request.headers`, not `headers()` from `next/headers`.
- **Killing the listener in tests:** each test bus gets a unique `application_name`; the test finds
  its backend in `pg_stat_activity` and calls `pg_terminate_backend`.
- **pg `Client` emits both `error` and `end`** when its backend dies, and an `error` with no listener
  crashes the process. The bus handles a drop once per connection (a generation counter) and gives
  abandoned clients a no-op error handler before ending them.
- **Compression buffers SSE.** Next's `compression` (gzip) holds small chunks; `Cache-Control:
no-transform` makes it skip the response (checked in `next/dist/compiled/compression`).
- **Unsaved input and refreshes.** React sets `defaultValue` / `defaultSelected` on uncontrolled
  fields, so "edited" is simply value differs from default (`isFieldEdited`); a select with no
  explicit default counts its first option as the default. Echoed values after a failed submit are
  defaults, not edits. Only forms with `data-unsaved-guard` block refreshes.
- **Activity and live pages.** A hidden page's effects are cleaned up, so it stops listening;
  `LiveRefresh` remembers it was hidden (a ref survives) and refreshes when shown again. In
  development, Strict Mode's double effect makes that one extra refresh on mount.
- **E2E changes.** The two stale-tab conflict specs call `withoutLiveUpdates(staleTab)` (aborts
  `/api/realtime`); otherwise the stale tab may refresh before the user submits and the conflict
  never happens. That is the scenario of a tab whose update has not arrived yet, which the version
  check still covers. `expectLive(page)` waits for the indicator before producing events.
- **E2E and the sign-up limit.** With 12 specs the suite passed 10 sign-ups from one address and
  hit the per-IP limit. `signUp()` now gives each test's browser context its own
  `x-forwarded-for` (TEST-NET-3, `203.0.113.x`), as distinct customers would have; the limit is
  unchanged.
- **Proven-red checks (checkpoint 3):** bus: publishing on the pool instead of the transaction
  (2 red: commit-only and rollback), no resync after reconnect (1 red), no validation on receipt
  (1 red). Services: no `previousDriverId` (1 red), announcing every ping (1 red). Route: no org
  check in `isVisibleTo` (1 red), drivers see the whole org (1 red), no previous-driver rule (1
  red), stream skipping the filter (2 red). E2E: `LiveRefresh` not refreshing (all 3 realtime
  specs red). All restored.
- **Visual check** (Playwright, 390 px and 1280 px, seeded dev data, production build): Live pill
  in both headers, "Last seen ... near ..." moving live, the deferred notice, "Reconnecting…"
  after stopping the server. One fix came out of it: the deferred notice rendered at the top of
  the page, off screen while the dispatcher is scrolled down to the form on a phone; it is now
  pinned to the bottom of the viewport.

### Live map (Phase 2, checkpoint 4)

- **Layout.** Pure: `src/lib/status-tone.ts` (status to tone to badge style and marker hex),
  `geo.ts` (bounds, straight route, easing, coordinate text), `live-positions.ts` (merging live
  fixes into the snapshot, list order), `formatElapsed` now goes to hours and days. MapLibre code
  lives only in `src/components/map/`: `maplibre.ts` (CSS imports, worker URL, `useMapLibreMap`,
  marker glide), `marker-elements.ts` (DOM markers), `fleet-map-canvas.tsx` /
  `route-map-canvas.tsx` (default exports, loaded with `next/dynamic` by `fleet-map.tsx` /
  `route-map.tsx`), `map-config.ts` (style URL, no MapLibre import). Page:
  `src/app/dashboard/map/`.
- **Gotcha: MapLibre 6 loads its worker from a separate file** (`maplibre-gl-worker.mjs`), found
  next to its own module URL. Bundled, that URL is a Next chunk and the file is missing, so tiles
  never decode. `setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs",
import.meta.url).href)` makes Turbopack emit the worker to `/_next/static/media/` and points
  MapLibre at it. (Turbopack also emits the unused `-dev` worker; it is never downloaded.)
- **Gotcha: `.maplibregl-map` sets `position: relative`**, and maplibre-gl.css loads after
  Tailwind, so an `absolute inset-0` map container collapsed to 0 px height. The container is
  `size-full` inside a sized `MapFrame`.
- **Gotcha: never scale a marker's own element.** MapLibre positions markers with `transform` on
  the element; CSS applies the separate `scale` property before `transform`, so `hover:scale-110`
  scaled the translation and moved the marker ~40 px away from the pointer (clicks landed on the
  canvas). Effects go on an inner disc (`group-hover:`). Found in the visual check.
- **Gotcha: MapLibre fires a map `click` for clicks on a marker**, even with `stopPropagation`
  (it tracks pointer events on the whole container). The map's close-on-click handler ignores
  targets inside `[data-shipment-marker]`.
- **Unmount and Activity.** `useMapLibreMap` creates the map in an effect and calls
  `map.remove()` in its cleanup, which runs on unmount and when Next hides the route, so a hidden
  page never holds a WebGL context or a worker. Showing the page again creates a fresh map fitted
  to the current markers. The open popup is reset in a `useLayoutEffect` cleanup, like the
  location-sharing switch.
- **Snapshot refresh.** No snapshot endpoint: the map page re-renders through `LiveRefresh`
  (resync, any `shipment_changed`, and via the new `alsoOn` prop a position for a shipment the
  snapshot lacks), and `FleetMap` merges the new `snapshot` prop with live fixes (newest device
  time wins). `router.refresh()` does reach client-held state, as long as the client derives from
  props rather than copying them into state once. The snapshot decides which shipments exist.
- **Server bundle and size.** MapLibre is absent from `.next/server`. Only the map page and the
  detail page reference its chunk, loaded after hydration: about 1.08 MB raw / 292 KB gzip of JS,
  plus the worker (519 KB / 147 KB gzip) and 72 KB / 10 KB gzip of CSS. The list and every other
  page load nothing new.
- **Attribution** is the style's own (OpenFreeMap, OpenMapTiles, OpenStreetMap), with
  `compact: false` so it stays expanded at 390 px.
- **Relative times** ("3 min ago") need the viewer's clock: `useNow` returns null during server
  rendering and hydration, and the UTC time shows until then.
- **Coordinates for the detail map** are optional at booking (the form does not ask), so UI-made
  shipments have no pickup/delivery pins; the map then shows only the live position (and appears
  for any unfinished shipment, ready for its first ping).
- **E2E.** `tests/e2e/fixtures.ts` extends `test` so the default context answers the style URL
  with an empty style and refuses anything else from `tiles.openfreemap.org`; contexts a spec
  creates call `blockMapTiles`. Specs import `test`/`expect` from `./fixtures`. Markers carry
  `data-lat`/`data-lng` (their target) for assertions. Headless Chromium has WebGL 2 (software).
  `live-map.spec.ts` waits for the server's 10 s ping throttle, hence `test.slow()`.
- **Seed positions.** The demo driver's unfinished shipments get one ping through
  `recordLocationPing` (injected clock): on-the-road ones a few minutes before the seed's `now`,
  the exception just before it stopped. Positions are interpolated along the route (straight line until checkpoint 5, the road route since) without
  drawing from the PRNG, so the rest of the seed is unchanged. 8 markers on a fresh seed.
- **Proven-red checks (checkpoint 4):** `FleetMap` ignoring position events (live-map spec red:
  the marker stayed at the first fix). Restored.
- **Visual check** (Playwright, 390 px and 1280 px, real tiles, seeded data, production build):
  dashboard map with and without a popup, detail page map. Fixes from it: the collapsed map
  container, markers jumping on hover, the popup closing as soon as a marker was clicked, the
  zoom buttons covering the delivery pin and clipping its label on a phone (the route map now fits
  with extra right padding), and a popup opened from the list is panned clear of the edges.

### Truck simulator and road routes (Phase 2, checkpoint 5)

- **Layout.** Pure: `src/lib/random.ts` (mulberry32, shared by seed and simulator),
  `src/lib/route-geometry.ts`, `src/server/seed/demo-data.ts` (the seed's draft),
  `src/server/simulator/truck.ts` (planner). Server: `src/server/routes/` (fixture schema, JSON,
  lookup), `src/server/simulator/simulator.ts`. Scripts: `scripts/simulate.ts`,
  `scripts/fetch-routes.ts`. Design and decisions 31-35 in the architecture doc.
- **Changing the seed's cities or plans** changes its city pairs: run `pnpm routes:fetch` and
  commit the new fixture (the coverage test in `road-routes.test.ts` fails until then). Changing the
  order of the PRNG draws in `draftShipment` changes every seeded shipment after it; the seed
  refactor was verified by diffing a time-independent dump of the seeded database before and after.
- **Gotcha: Node's `fetch` ignores `HTTPS_PROXY`.** In this environment run
  `NODE_USE_ENV_PROXY=1 pnpm routes:fetch` (Node 22.21+, prints an "experimental" warning). curl
  works without it. The OSRM demo server answered every request.
- **Injectable clocks.** `changeShipmentStatus` and `assignDriver` take `deps.now` like `createShipment`
  and `recordLocationPing`; the simulator passes its clock to all of them, so its test clock needs no
  real-time offset.
- **Throttle in the simulator.** The tick is 12 s and `recordLocationPing` gets the simulator's
  clock as server time; a throttled ping is logged and the truck keeps its new distance, so the
  next accepted ping reports where it really is (integration test with 4 s steps).
- **Exception ownership** is read from history each tick (latest status event's actor equals the
  truck's driver), not remembered, so `--once` and restarts resume the simulator's own exceptions.
  Consequence: the seed's driver-recorded exceptions are cleared within a minute of starting the
  simulator; office-recorded ones stay.
- **Stopping it.** The script exits 0 after the current tick on SIGINT. When killing it from a
  script, signal the process group or the node process; a `pkill -f` pattern that also matches
  the `sh -c` pnpm spawns makes pnpm print `ELIFECYCLE` even though the simulator stopped cleanly.
  `pgrep -f <pattern>` also matches the shell running it.
- **Proven-red checks (checkpoint 5):** sending the delivery before the arrival ping (2 unit and
  the end-to-end integration test red: the service refuses the late ping as `inactive`). Restored.
- **Visual check** (Playwright, 1280 px and 390 px, real tiles, fresh seed, production build,
  simulator running): live map twice about a minute apart (every truck moved, e.g. 53.07,9.12 →
  53.26,9.44 towards Hamburg; two deliveries left the map), the detail map with the Rotterdam →
  Hamburg road route, and the public page of a simulator-delivered shipment (text only, notes
  read well). Nothing needed fixing beyond the known marker overlap.

### Simulator refill (Phase 4a follow-up)

- **Resolved: "the demo runs out of trucks".** The simulator books replacements when fewer than 6
  drivable shipments remain (max 2 per tick). Design and decision 46 in the architecture doc; code
  in `src/server/simulator/booking.ts` (pure, `booking.test.ts`) and `refill()` in `simulator.ts`.
- **Gotcha: `TickReport` has a new required `booked` field**; tests that stub `tick()` must return
  it (`booked: []`).
- **Gotcha: the refill counts drivable shipments, not the whole organization's.** Unassigned or
  uncoordinated shipments do not stop it from booking. A tick that finds an office-held exception
  does not count that truck.
- **`pnpm simulate` flags:** `--no-refill`, `--target <n>`. `--once` still books when short, with
  the same seed it books the same shipments.
- **Proven red:** with refill disabled in `refill()`, 3 of the 4 refill integration tests fail
  (the fourth, "at target / no refill option", holds for both). Restored.

### CI and hardening (Phase 4a, checkpoint 1)

- **Runtime environment: `src/server/env.ts`.** App code reads `env.database.url`,
  `env.database.directUrl`, `env.auth.secret`/`url`, `env.realtime.streamSeconds` and
  `env.demo.enabled`/`cronSecret`, never `process.env`. Each group is validated with Zod the first
  time it is read (then cached), so importing never throws and `next build` needs no env. Errors
  name the variable and never echo a value. Reading `env.database` does not require the auth
  variables, so the seed and simulator still run with only a database URL.
  - `createEnv(source)` builds the same lazy object from any record (unit tests);
    `validateEnv(source)` checks every group at once and lists all problems, for the
    `vercel-build` validation step in checkpoint 2.
  - Direct URL precedence: `DATABASE_DIRECT_URL`, then `DATABASE_URL_UNPOOLED` (Neon's Vercel
    integration), then `DATABASE_URL`. Blank values count as unset (`.env.example` lists them
    blank). Vitest and Playwright set `DATABASE_DIRECT_URL` to the test database explicitly, so an
    `UNPOOLED` URL in `.env` can never point a test's listener elsewhere.
  - A malformed `REALTIME_STREAM_SECONDS` (`soon`, `0`, `12.5`) now fails the first stream with a
    clear error instead of silently using 270 s. `streamLifetimeMs` takes the parsed number.
  - Better Auth gets `secret` and `baseURL` from `env.auth` explicitly (it would otherwise read
    `process.env` itself, unvalidated). The secret must be at least 32 characters.
  - Scripts (`scripts/*`, `tests/e2e/*.ts`, `drizzle.config.ts`) and test setups keep their own
    `process.env` reads: they deliberately point `DATABASE_URL` at other databases and run name
    guards first.
- **Security headers: `src/lib/security-headers.ts`**, applied to every path by `headers()` in
  `next.config.ts` (pure module, unit tested; `next.config.ts` imports it by relative path).
  - The CSP allows `'unsafe-inline'` scripts on purpose (decision 40): Next inlines the RSC
    payload as `<script>` tags, and nonces would make every partially prerendered page dynamic.
    Verified: without `'unsafe-inline'`, sign-up never hydrates. `react/no-danger` is an ESLint
    error to back this up; never render raw HTML.
  - Adding any external origin (analytics, an image host, an upload bucket in Phase 3) means adding
    it to the right directive there; the e2e spec will fail otherwise.
  - `worker-src 'self'` is enough: MapLibre's worker is a bundled same-origin file
    (`setWorkerUrl`). `blob:` was tried and removed (tested against real tiles without it).
  - No `upgrade-insecure-requests`: Vercel serves HTTPS only (and adds HSTS), every URL the app
    uses is relative or `https:`, and the directive would only get in the way of local HTTP runs.
  - In `next dev` the policy adds `'unsafe-eval'` (React's dev tooling); never in production.
- **`tests/e2e/security-headers.spec.ts`** walks the landing page, sign-in, dashboard, driver app
  (sharing its location), live map, detail page and public tracking page, and fails on any
  `securitypolicyviolation` event or console CSP report (`recordCspViolations` in `helpers.ts`).
  Proven red three ways: no `'unsafe-inline'` (scripts), no tile origin in `connect-src` (caught
  even with tiles blocked, since the style request is checked before Playwright's routing), and
  `worker-src 'none'`.
- **`E2E_MAP_TILES=live pnpm test:e2e`** makes `blockMapTiles` a no-op so maps load the real
  basemap (manual checks and screenshots only; never in CI). Gotcha: `signUp` sets an
  `x-forwarded-for` header on the whole context, which also goes to the tile server and turns
  every map request into a CORS preflight it refuses. Clear it (`setExtraHTTPHeaders({})`) before
  opening a map with live tiles.
- **`robots.ts`** allows `/` and disallows `/dashboard`, `/driver`, `/track`, `/api`, `/sign-in`
  and `/sign-up`. Not `Disallow: /` + `Allow: /$`: that would also block the landing page's
  assets under `/_next/`. Tracking pages keep their `noindex` (robots.txt does not stop a linked URL
  being indexed).
- **CI: `.github/workflows/ci.yml`.** Order matters: format, lint and typecheck, then `pnpm build`
  **before** any `.env` exists (proves the no-env-at-import rule on every push), then the
  database role and `.env` (throwaway secret from `openssl rand`), `pnpm test`, Playwright's own
  Chromium (`playwright install --with-deps chromium`, CI only, never here), `pnpm test:e2e`. The
  HTML report (CI reporter: `github` + `html`) and `test-results/` traces are uploaded on failure.
  Actions are pinned to the newest major tags as of November 2026 (checkout v7, setup-node v7,
  pnpm/action-setup v6, upload-artifact v7; looked up with `git ls-remote --tags`). The job
  builds twice (once without env, once inside `test:e2e` against the e2e database), about a minute.
- **Validating the workflow locally:** YAML parsed with js-yaml, then the exact command sequence
  ran in a fresh `git clone` with `CI=true` against a brand-new Postgres 16 cluster
  (`pg_createcluster 16 ci -p 5433`, dropped afterwards), the only difference being the port.
  All green (15 e2e specs). The first real GitHub run happens on push.
- **Visual check** (1280 px and 390 px, production build, real tiles): landing, sign-in, live map,
  staff detail with route map, driver detail and public tracking page all render normally under
  the CSP (fonts, styles, tiles, glyphs, markers). Nothing needed fixing.

### Deploy pipeline and demo mode (Phase 4a, checkpoint 2)

- **Auth URLs per environment: `src/server/auth/base-url.ts`** (pure, unit tested).
  `BETTER_AUTH_URL` wins; else on Vercel `https://$VERCEL_PROJECT_PRODUCTION_URL` (production,
  falling back to `$VERCEL_URL`) or `https://$VERCEL_BRANCH_URL` / `$VERCEL_URL` (preview); outside
  Vercel it is still required. `env.auth.trustedOrigins` lists every host of the deployment and is
  passed to Better Auth. Vercel's `VERCEL_*` hosts carry no scheme. Gotcha: Better Auth only
  checks the `Origin` header on requests that arrive through its HTTP handler; our Server Actions
  call `auth.api.*` directly, so `trustedOrigins` mainly matters for `/api/auth/*`.
- **`env.ts` additions:** `BETTER_AUTH_URL` optional on Vercel (the error says why it is required
  elsewhere, and is listed together with other problems by `validateEnv`: a refinement with
  `when: () => true`, because Zod skips object refinements after a field failed). Demo group:
  `CRON_SECRET` at least 16 characters, `DEMO_RESET_DATABASES` required when `DEMO_MODE=true`
  (comma-separated names, `env.demo.resetDatabases`).
- **Database-name guards, the design.** Only _wipes_ are guarded; migrating and seeding never look
  at the name, so Neon's `neondb` is never blocked. The local scripts keep their hard-coded names
  (`pnpm db:seed --reset` and `pnpm simulate`: only `waybill`; test setups: `_test`, `_e2e`). The
  hosted reset has no hard-coded name: it needs `DEMO_MODE=true`, the secret, and the database
  named in `DEMO_RESET_DATABASES`; `vercel-build` checks the allow-list too, so a wrong name fails
  the deploy, not the first night. Also checked: pooled and direct URLs name the same database.
- **`pnpm vercel-build` (`scripts/vercel-build.ts`, `src/server/deploy/build-plan.ts`):**
  `validateEnv` (all problems), `migrateDatabase(directUrl)`, `seedDemo()` if demo, `next build`.
  Does not read `.env` (on Vercel the project's variables are the environment). `vercel.json` sets
  `buildCommand` explicitly rather than relying on `vercel-build` being auto-detected.
  `migrateDatabase` (`src/server/db/maintenance.ts`) holds a `pg_advisory_lock` for the run so
  two deploys sharing a database take turns. Tested locally against a fresh database: nothing set,
  demo on with a database missing from the allow-list, an unreachable direct URL (each fails
  loudly, exit 1), then a full run twice (second seed is a no-op).
- **Migrations folder is `process.cwd()`-relative** (`MIGRATIONS_FOLDER`), not `import.meta.dirname`:
  the cron route runs migrations inside the app, where a bundler moves the file; and
  `outputFileTracingIncludes` in `next.config.ts` ships the SQL files with that one route
  (verified in `.next/server/app/api/cron/reset-demo/route.js.nft.json`).
- **Cron: `vercel.json`** `0 3 * * *` for `/api/cron/reset-demo` (one job, daily: Hobby). The
  constants live in `src/domain/demo.ts`; a unit test keeps `vercel.json` equal to them. The banner
  says "around 03:00 UTC" because a Hobby daily job runs at some point within its hour.
- **`GET /api/cron/reset-demo`:** 404 unless demo mode, 401 unless `Bearer <CRON_SECRET>`
  (`isCronAuthorized`: SHA-256 of both sides, then `timingSafeEqual`, so lengths do not leak),
  then `resetDemo()`: allow-list check, `resetDatabase(directUrl)`, `seedDemo()`. A refusal is a
  generic 500 (details in the function log). `maxDuration = 300`; locally it takes about a second.
  Tests use a dedicated database (`tests/integration/dedicated-database.ts`:
  `<TEST_DATABASE_URL name>_demo_test`, created and migrated on first use): the main test database
  must not be wiped or get `admin@demo.test`, which would turn the seed test into a skip. Proven red:
  secret check replaced by `true` (5 tests fail), demo gate removed (4 fail).
- **`POST /api/demo/tick`** (`advanceDemoSimulation` service, route stays thin). Order: demo mode
  (404) before the session (401) before the organization (403) before the throttle, so a stranger
  cannot spend the throttle. "The demo organization" is the one the seeded `admin@demo.test`
  belongs to, never found by name: sign-up is open on a public demo, and anyone can call their
  company "Demo Freight Co" (a test does exactly that and gets 403). Signed-in only (not public):
  the demo's data is not public, and a public write endpoint would invite abuse.
- **The tick throttle** (`claimDemoTick`, table `demo_tick_state`, migration 0006, a new table, so
  backward compatible): one conditional upsert, same pattern as the ping throttle. Forced race in
  `tick-throttle.integration.test.ts` (a third transaction holds the row `FOR UPDATE` until both
  contenders are blocked): proven red against a read-then-write version (and the plain parallel
  burst still passed against it, as CLAUDE.md warns). The window uses the app server's clock, as
  the ping throttle does; skew between instances is far below 12 s.
- **Simulator on serverless.** One simulator per instance on `globalThis` (`getDemoSimulator`),
  drivers resolved on every tick (the reset recreates them; `SimulatorOptions.drivers` may now be
  a function). A new instance picks trucks up from their stored positions, so nothing jumps. What
  an instance forgets: an exception's countdown and "already had one", so a truck's exception may
  last longer or recur when ticks move between instances. Accepted for a demo.
- **Demo UI.** `DemoOnly` (`await connection()`, then `env.demo.enabled`) inside
  `<Suspense fallback={null}>` renders the banner (root layout), the one-click buttons (sign-in
  page) and the ticker (`DemoLive` on the live map and staff detail page). Read at request time,
  so one build serves both modes (the e2e uses that) and the rest keeps its static shell; in demo
  mode the banner streams in a moment after the shell (a small layout shift, accepted). The
  one-click buttons post a _role_ to `demoSignInAction`, which looks up the email and the published
  password server-side and calls the same `signIn` service (rate limits included; an e2e test
  exhausts an address's allowance and clicks a button). No credentials are in the page.
- **Ticker (`src/lib/demo-ticker.ts`, pure, fake-timer tests):** 12 s + up to 3 s jitter after the
  previous request finished, paused and aborted when the tab is hidden, stops on unmount and on
  401/403/404. Gotcha found by the e2e: the `fetch` body must be read (`arrayBuffer()`), or the
  response never finishes loading and a test (or a connection) hangs.
- **E2E for demo mode:** a second web server of the same build (`next start --port 3101`) with
  `DEMO_MODE=true` against `waybill_demo_e2e` (derived from `E2E_DATABASE_URL`; prepared and
  seeded by its command), a second Playwright project `demo` that runs only `demo.spec.ts`. Servers
  start in order, so the second reuses the first's build. The first server pins `DEMO_MODE=false`
  so a developer's `.env` cannot change the regular specs. `demo-off.spec.ts` proves nothing demo
  renders and both endpoints are 404 there (proven red by forcing `DemoOnly` to render).
- **Visual check** (390 px and 1280 px, banner, sign-in with the demo card, live map under the
  banner): fine. The banner's dismiss button was enlarged to a 28 px touch target.
- **Docs could not be checked at the source.** `vercel.com` and `neon.com` were unreachable from
  the build environment (`getaddrinfo ENOTFOUND`; web search worked). `docs/deployment.md` marks
  which statements are verified only through search summaries; the architect or owner should skim
  the linked pages. Facts the code depends on were confirmed that way: `VERCEL_*` hosts have no
  scheme; `CRON_SECRET` arrives as `Authorization: Bearer …`; Neon's `DATABASE_URL` is pooled,
  `DATABASE_URL_UNPOOLED` direct; previews get branch `preview/<git-branch>`.
- **Still the owner's job:** the dashboard steps (the README already links the live demo).

### Public API (Phase 3, checkpoint 1)

- **`api` is not a member role.** `ROLES` / `Role` are what Better Auth stores; `ActorRole`
  (`Role | "api"`) is what `AuthContext.role` and the permission functions take. Server-side
  session helpers return `MemberAuthContext` (`role: Role`) so `homePathFor` and `ROLE_LABELS`
  stay total. If you add a permission function, add the `api` row to its test (the tests are
  `Record<ActorRole, ...>`, so a missing row is a type error).
- **Events made through the API are attributed to the key's creating admin** (the context's
  `userId`), so the history shows that admin's name. Decision 54 records the alternative.
- **Route files may only export handlers** (Next rejects other exports), so shared constants live
  in `src/server/api/` (`request-fields.ts`), which the OpenAPI test imports.
- **Route handlers are tested by calling them** with a constructed `Request` and
  `{ params: Promise.resolve(...) }`, like `app/api/realtime`. The helper lives in
  `src/app/api/v1/api.integration.test.ts`. Give every call its own random `x-forwarded-for`, or
  one test's failed-key attempts count against the next test's per-IP limit.
- **The forced race over HTTP** uses two keys so the two requests do not queue on one rate-limit
  counter (it would be a second lock to wait on); only the held shipment row blocks them.
- **A CHECK cannot take bind parameters**, so the scopes CHECK is emitted from the `API_SCOPES`
  constant as a literal array (`sql.raw`). Adding a scope later means a migration that replaces
  `api_keys_scopes_known`.
- **`drizzle-kit` names migrations randomly**; rename the SQL file and the `tag` in
  `meta/_journal.json` together (0007 is `0007_api_keys`).
- **Mobile navigation:** the dashboard header nav is hidden below `sm`, so the API keys link, like
  Live map, is desktop-only; the page itself works at 390px.
- **Not done on purpose:** no CORS (server-to-server API), no key rotation or expiry, no per-key
  event attribution, no audit log of key use beyond `last_used_at` (minute granularity).

### Signed, retried webhooks (Phase 3, checkpoint 2)

Design in `docs/architecture.md` ("Webhooks without a long-running worker", "As built (checkpoint 2)"),
decisions 58 to 62; receivers' guide in `docs/api.md` ("Webhooks").

- **Where things are.** Pure: `src/domain/{ip-address,webhook-url,webhook-signature,webhooks}.ts`.
  I/O: `src/server/webhooks/` (`destination.ts` SSRF guard, `transport.ts` pinned POST, `payloads.ts`,
  `drain-throttle.ts`, `schedule.ts` the two `after()` hooks) and `src/server/services/webhook-{outbox,delivery,endpoints}.ts`.
  UI: `/dashboard/settings/webhooks`.
- **Services must enqueue inside their transaction** (`enqueueShipmentCreated` and friends, next to
  `announceShipmentChange`). A new write path that changes what an event says needs the same call.
- **Never `await` a delivery in a request.** Use `deliverOutboxAfterResponse()` after a change and
  `drainOutboxOnActivity()` for the throttled heartbeat. They are no-ops outside a Next request
  scope (the helper swallows the "outside a request scope" error), so tests and CLI scripts leave
  rows queued; the simulator script and the seed therefore do not deliver webhooks.
- **A drain claims every due row in the database.** Integration tests that count deliveries park the
  other open rows first (`beforeEach` in `webhook-delivery.integration.test.ts`); test endpoints use a
  `.invalid` URL by default (`tests/integration/webhooks.ts`) so a stray drain never leaves the machine.
  Tests pass `policy` / `resolve` / `transport` through `DeliveryDeps` instead of touching env.
- **Local receivers:** tests and the e2e spec use `127.0.0.1` URLs. The e2e server runs with
  `WEBHOOKS_ALLOW_LOCAL_TARGETS=true` (set in `playwright.config.ts` for the main server only);
  `createEnv` refuses the flag when `VERCEL` is set or demo mode is on. `localhost` as a name may
  resolve to `::1` first on some machines; use the literal in tests.
- **A CHECK with `IN (...)` is NULL-valued for a NULL column**, and a CHECK passes on NULL. The first
  version of `webhook_endpoints_disabled_reason_matches` let `enabled = false` with no reason through;
  the schema test caught it (`IS NOT NULL` was added). Check the NULL case of every such constraint.
- **Zod list errors are keyed `eventTypes.2`.** `validationFailure(error, { "eventTypes.": "eventTypes" })`
  folds them onto the one field the form shows. The save-time URL check also runs when another field
  failed, so one submit reports every problem.
- **Proven red:** without the outbox call inside the transaction the rollback test fails; without
  `SKIP LOCKED` the forced race blocks (and "many concurrent drains" hangs); without the lease the
  mid-request drain sends the delivery twice; with the address check disabled all six SSRF tests fail;
  without the membership join four API-key tests fail.
- **Mobile navigation:** like API keys, the Webhooks link is in the desktop header only; the page
  works at 390 px (checked, no horizontal scroll).
- **Known gaps:** no retention job for old deliveries (rows are kept; add to the daily purge when the
  log grows); a retry waits for activity or the daily cron, so on a quiet Hobby deployment a 1-minute
  retry may happen hours later (documented in `docs/api.md`); the delivery log does not update live
  (reload to see results).

### Email notifications (Phase 3, checkpoint 3)

Design in `docs/architecture.md` ("Email", "As built (checkpoint 3)"), decisions 63 to 66; enabling
Resend in `docs/deployment.md`.

- **Where things are.** Pure: `src/domain/{email,unsubscribe-token}.ts`, `src/server/email/templates.ts`.
  I/O: `src/server/email/{transports,unsubscribe}.ts`, `src/server/services/email-{outbox,delivery,notifications}.ts`.
  UI: the "Customer emails" card on the shipment page, `/dashboard/settings/email-previews`, public
  `/unsubscribe/[token]`.
- **The scheduling helpers were renamed** `deliverOutboxAfterResponse` and `drainOutboxOnActivity`:
  they now drain webhook deliveries and emails together. New write paths that queue either call them.
- **Queue inside the transaction, render there too.** `enqueueStatusEmail` runs in
  `changeShipmentStatus`'s transaction. Add the same call for any new event that should email.
- **Internal notes cannot reach an email:** `renderStatusEmail`'s input has no such field. Keep it so;
  the outbox test (internal note never in the stored message) was proven red by passing one in.
- **Preview is a state of the same row, not a second store.** A queued message becomes `succeeded`
  with `transport = 'preview'` when the preview transport "sends" it, so previews only list messages
  that have been drained. In tests call `drainDueEmails(..., { transport: previewTransport })`.
- **Env:** `RESEND_API_KEY` and `EMAIL_FROM` are validated together (one without the other is an
  error, except in demo mode where both are ignored). Integration tests rely on `BETTER_AUTH_SECRET`
  and `BETTER_AUTH_URL` from `.env` (CI writes them) because links and tokens are built from them.
- **Resend adapter:** plain `fetch`, checked against https://resend.com/docs/api-reference/emails/send-email
  (header `Idempotency-Key`, 256 characters at most, 24 hours; body `from`, `to`, `subject`, `text`,
  `html`, `headers`). Never called live from tests or CI; `createResendTransport({ baseUrl })` points at
  a local fake. Not exercised against the real API from this environment.
- **Email status on the shipment page does not update live:** the realtime refresh fires at commit,
  before the message is sent. A reload shows Preview only or Sent.
- **A drain claims every due email in the database,** like the webhook drain: the delivery tests park
  other open rows first (`beforeEach`).
- **Proven red:** internal note leaked into the template, enqueue outside the transaction, no opt-out
  check at queue time or at send time, and a changing idempotency key each fail their tests.
- **Mobile navigation:** the Emails link is in the desktop header only; both pages were checked at
  390 px (no horizontal scroll).

### Proof of delivery (Phase 3, checkpoint 4)

Design in `docs/architecture.md` ("Proof of delivery", "As built (checkpoint 4)"), decisions 67 to 72;
enabling Blob in `docs/deployment.md`.

- **Where things are.** Pure: `src/domain/delivery-proof.ts` (signature schema and caps, SVG path
  building, photo sniffing and metadata stripping, `photoCaptureAvailable`),
  `src/lib/signature-recorder.ts` (the pad's state machine), `src/lib/photo-resize.ts`.
  I/O: `src/server/storage/` (`PhotoStorage` interface, Vercel Blob adapter, in-memory fake),
  `services/deliver-shipment.ts` (validates, stores the photo, composes `changeShipmentStatus`),
  `services/delivery-proof.ts` (staff read model, photo read), the photo route
  `/dashboard/shipments/[id]/proof-photo`. UI: `delivery-sheet.tsx` (driver), `SignaturePad`,
  `SignatureView`, `ProofOfDeliveryCard`.
- **`changeShipmentStatus` takes `deps.proof`** (a validated `DeliveryProofRecord`) and writes the
  `delivery_proofs` row after the event, inside the same transaction and before the webhook and
  email enqueues, so those can mention it. A **driver cannot deliver without proof** (validation
  error on `recipientName`); staff and API keys can, and no row is written. Seed and simulator pass
  `sampleProof(...)` (generated signature, `demo/sample` photo key) for drivers' deliveries.
- **No FK from `delivery_proofs.event_id` to `shipment_events`.** A table that other tables reference
  cannot be truncated at all (Postgres answers `0A000` before any trigger runs), which turned the
  existing "TRUNCATE is rejected" test for `shipment_events` red. Proofs are tied to their shipment
  by the composite tenant FK and to their event by the one code path that writes both.
- **Photo order of operations:** validate, gate (shipment visible and role allowed) before any
  upload, upload under `delivery-proofs/<org>/<shipment>/<uuid>.<ext>`, run the transaction, delete
  the photo if it did not commit. A crash in between leaves an unreferenced private file. Upload
  has a 20 s timeout (`photo_failed` result, nothing delivered), found by a screenshot run with a
  fake token where the SDK's retries made "Delivering..." hang.
- **Server Action body limit raised to 4.5 MB** (`next.config.ts`, `experimental.serverActions`) for the
  photo; server cap is 4 MB. The browser shrinks photos to 1600 px JPEG first (drops EXIF, fixes
  rotation, converts HEIC/WebP); the server sniffs magic bytes, accepts JPEG and PNG only and strips
  EXIF/XMP/IPTC/comments (JPEG) or `eXIf`/text chunks (PNG) itself. WebP is refused server-side.
- **Preview of the photo before upload is a `data:` URL** (the CSP allows `data:` images, not `blob:`).
  No CSP change was needed at all: the stored photo is proxied through the route (`img-src 'self'`).
- **E2E:** the e2e server has no Blob token, so photo capture is hidden there. To look at the photo UI
  run Playwright with `BLOB_READ_WRITE_TOKEN=anything`; do not submit a photo (it would try the real
  store). Photos are covered by integration tests with the fake and the demo spec's sample photo.
  Locate the proof card with `[data-testid=proof-of-delivery]:visible` (a hidden copy can exist).
- **The delivery sheet pins the version** it was opened at, so a live refresh behind it cannot turn
  the delivery into one of a changed shipment (conflict instead).
- **Proven red:** proof written with `getDb()` instead of `tx` (rollback test), a public projection
  that returns more than the name (key-set test), the photo storage factory ignoring `enabled`
  (two tests: demo mode would build the Blob adapter).
- **Known gaps:** no retention or erasure for proofs or photos (decision 70), no sweep of
  unreferenced photos, the Blob adapter is not exercised against the real service from CI or this
  environment (unit test with the SDK mocked), no way to add proof to a delivery afterwards, the
  driver app does not show the proof after delivering, the sheet's photo and signature are lost if
  the sheet is closed.
- **Mobile navigation:** unchanged. Sheet, staff card and public page checked at 390 and 1280 px.

### AI intake (Phase 3, checkpoint 5)

Design in `docs/architecture.md` ("AI intake", "As built (checkpoint 5)"), decisions 73 to 77; enabling it
in `docs/deployment.md`.

- **Where things are.** Pure: `src/domain/intake.ts` (fields, limits, country, weight and date
  normalizers, grounding check; no Zod, so the browser may import it). Server: `src/server/intake/`
  (`model.ts` interface and fake, `anthropic-model.ts`, `prompt.ts`, `schema.ts`, `draft.ts`
  `buildDraft`, `fixtures.ts`, `index.ts` `getIntakeModel`), `services/intake.ts`
  `extractShipmentDraft`. UI: `dashboard/shipments/new/` (`intake-action.ts`, `intake-panel.tsx`,
  `draft-note.tsx`, `new-shipment-workspace.tsx`; the form takes a `draft` prop and remounts, keyed
  by the draft's id). `scripts/intake-eval.ts`.
- **Env:** `ANTHROPIC_API_KEY`, `INTAKE_MODEL`, `INTAKE_USE_FAKE_MODEL` (group `intake`). The fake is
  refused on Vercel and in demo mode and wins over a key. The e2e main server sets it
  (`playwright.config.ts`); the demo server has no key, so its spec checks the panel is absent.
- **SDK facts checked in the installed package** (`@anthropic-ai/sdk` 1.3): `messages.create` takes
  `output_config: { effort, format: { type: "json_schema", schema } }`; no tools are sent, which
  also sidesteps forced `tool_choice`, which several current models reject. `z.toJSONSchema` makes
  the schema (delete `$schema`, `additionalProperties: false`). Not run against the live API here.
- **Tests that matter:** the fixtures run through the fake and `buildDraft` (unit); grounding,
  invalid-value, unknown-key and compromised-answer tests; adapter test with the SDK mocked (request
  shape, no tools, email only in the user message, errors never log the email); service integration
  tests (hidden without a key, forbidden for drivers, no shipment ever created, 20 KB cap in bytes,
  50 per day then a refusal, the demo's global cap, a failed call still counts); e2e with the fake.
- **Proven red:** removing the cap check (2 service tests red), and removing both the booking-rule
  validation and the grounding check in `buildDraft` (6 red).
- **Gotcha: client code must not import Zod.** `src/domain/intake.ts` stays schema-free for that
  reason (see the proof-of-delivery CSP note); the Zod schemas are under `src/server/intake/`.
- **Gotcha: the intake panel's `defaultValue` echo.** React resets uncontrolled fields after an
  action, so the pasted text is echoed back through state, like every other form here.
- **Known limits:** see architecture "Known limits". Notably an address present in the email's
  injected text can still be drafted (a person reviews every field).
- **Mobile navigation:** unchanged. The panel and the prefilled draft were checked at 390 and
  1280 px (no horizontal scroll).

### Testing

- `pnpm test` runs two Vitest projects: `unit` (`src/**/*.test.ts`) and `integration`
  (`src/**/*.integration.test.ts`).
- Integration tests need **Postgres running** (`service postgresql start`) and **`.env` with
  `TEST_DATABASE_URL`**. The global setup (`tests/integration/global-setup.ts`) drops and recreates
  the `public` and `drizzle` schemas of that database, then applies every committed migration. It
  refuses to run unless the database name ends in `_test`.
- For code under test, `DATABASE_URL` is overridden to `TEST_DATABASE_URL`. Files run serially.
- `createTestContext(orgId, role)` in `tests/integration/fixtures.ts` creates a member and returns
  the `AuthContext` a service receives for them.
- Tests never clean up: fixtures use random ids, so tests are isolated without deleting rows
  (history rows cannot be deleted anyway).

### Demo location privacy (found on the live demo)

- **The bug.** On the hosted demo anyone can sign in as the demo driver and tap "Share my
  location"; the browser's real position was stored through `recordLocationPing` and shown to every
  other visitor on the live map (a ping from India appeared on a Paris-bound truck). It also fought
  the simulator's positions. Branch `fix-demo-location-privacy`; decision 47 and "Demo mode" in the
  architecture doc.
- **The fix.** The Server Action calls `recordDriverLocation` (new, `src/server/services`). Outside
  demo mode it is `recordLocationPing`, unchanged. In demo mode it reads only the shipment id,
  derives the next point along the road route from the last stored position
  (`nextSimulatedPosition` + `simulatedStepMeters` in `src/server/simulator/simulated-position.ts`,
  pure, same pace as the simulator) and calls `recordLocationPing` with it. The client side is a
  `createSimulatedPositionSource` (`src/lib/location-sharer.ts`) that only supplies the beat: no
  `navigator.geolocation` access at all, placeholder coordinates that the demo sender drops.
- **Gotcha: do not put the guard inside `recordLocationPing`.** The simulator calls it as the demo
  driver, in demo mode, with positions it computed; a guard there would overwrite them. New code
  that takes a position from a client must go through `recordDriverLocation` (or ignore client
  coordinates itself in demo mode).
- **Gotcha: `LocationPingInput` is `{ shipmentId } & Partial<Fix>`.** The fix is required outside
  demo mode (a bare id is a validation failure there) and ignored inside it.
- **Gotcha: a demo shipment without stop coordinates has no route.** `recordDriverLocation` answers
  `no_route`; the action maps it to a stop with a message. Seeded and simulator-booked shipments
  always have coordinates; UI-booked ones do not (no geocoding).
- **Demo pace.** A visitor's pings move the truck by the simulator's step (about 8 km on the road)
  each, from its last stored position, so a truck that is both ticked and "shared" advances faster
  than one that is only ticked. Both always continue from the stored position, so nothing jumps
  back. The throttle (10 s) still applies, shared with the simulator's pings.
- **Tests.** Unit: `simulated-position.test.ts`, `location-sharer.test.ts` (the simulated source).
  Integration: `record-driver-location.integration.test.ts` (crafted coordinates in demo mode are
  stored as the route position; supplied coordinates stored outside it; scope, throttle, no route;
  demo mode read from `DEMO_MODE`). Proven red: with the demo branch bypassed 7 of the 10 fail;
  with the component touching `navigator.geolocation` in demo mode the demo e2e fails. E2E (demo
  project): the driver switches on sharing, `navigator.geolocation` is stubbed to record any touch
  (even reading the property) and to throw, and the stored position is the simulated one, not the
  browser's (set to Delhi). Visual check at 390 and 1280 px: the note sits under the description and
  reads fine on one phone screen.

### Live intake evaluation (2026-11-02)

First run of `pnpm intake:eval` against `claude-haiku-5-5` (owner's key): 110/112 fields (98%), and
it confirmed the adapter's request shape (structured output, `effort: "low"`) is accepted. The
prompt-injection fixture extracted cleanly; its instructions were ignored. Two misses, both fixed
in the system prompt (`src/server/intake/prompt.ts`): "same day please" was turned into a delivery
time (a service level is not a date), and a business name was kept in the pickup address line
(address lines are now street and house number only). Re-run `pnpm intake:eval` after prompt
changes; it is the only check against the live model.

Re-run after the prompt fix (2026-11-03): **112/112 fields (100%)**.

## Known issues / TODOs

- **The CSP allows inline scripts** (decision 40). An injected inline `<script>` would run; the
  defences are React's escaping and the `react/no-danger` lint rule. If Next ever supports nonces
  or hashes with partial prerendering, tighten `script-src`.
- User deletion fails with an FK error once the user has created shipments or events (by design).
  Org deletion is disabled in Better Auth (`disableOrganizationDeletion`).
- Sign-up is two Better Auth calls (user, then org) that cannot share a DB transaction; on org
  failure the user is deleted again (compensation), but a crash between the two would leave an
  org-less user, who can sign in but gets redirected away from `/dashboard`.
- Only one organization per user is supported in the UI (no org switcher).
- **The client IP trusts `x-forwarded-for`.** Correct behind Vercel or another proxy that sets it;
  a self-hosted deployment without such a proxy lets clients choose their IP for the per-IP limits
  (the per-account sign-in limit still holds per IP chosen). Documented in `client-ip.ts`.
- **Distributed password guessing.** The per-account sign-in limit is keyed on email + IP, so an
  attacker rotating many IPs gets 5 guesses per IP per account. A per-email limit (any IP) would stop
  that but lets anyone lock a victim out. Planned fix: a looser per-email cap (e.g. 20/hour) plus
  breached-password checks at sign-up; at scale, CAPTCHA after repeated failures.
- **Seeded dates age.** The demo seed is a one-off; rerun `pnpm db:seed --reset` locally for fresh
  "recent" dates. The hosted demo gets them from the nightly reset.
- `notFound()` on dynamic pages streams a 200 with `noindex` (see checkpoint 5b gotchas).
- Sign-up says when an email is already registered (account enumeration). Accepted for now as a
  product choice; revisit with email verification in Phase 3 ("check your email" response).
- An org-less user (see sign-up above) is sent to `/sign-in` while still signed in, which is
  confusing. A dedicated "no organization" page would be clearer.
- **The confirm step for delivered/cancelled is client-side only** (fixed in checkpoint 2, see the
  checkpoint 2 notes). Without JavaScript the form submits directly; proof of delivery (Phase 3)
  replaces the step for deliveries.
- **Location pings are never purged yet.** The 30-day retention job is Phase 4; it will want an
  index on `location_pings (received_at)` (or a time-partitioned table at scale).
- **Drivers see internal notes and other drivers' names in the history** (getShipment returns the
  organization's full history to any member who can see the shipment). Architect decision: keep.
  Internal means "inside the company", and office notes such as gate codes are for drivers. Revisit
  only if notes ever need a staff-only level.
- **Wrong-surface redirects are client-side** (see checkpoint 1 gotchas). A role-aware proxy
  would need the role in the session cookie, which conflicts with decision 8.
- **Realtime: a role or membership change does not end open streams.** The stream's
  `AuthContext` is resolved once per connection; a demoted or removed member keeps receiving
  invalidations (ids and positions of their former scope) until the stream's next reconnect, at
  most 270 s. Acceptable for invalidations; a revocation signal on the bus would close it sooner.
- **Realtime: a tiny gap on client navigation.** A page's data is fetched on the server before its
  `LiveRefresh` subscribes in the browser; a change committed in those milliseconds is not
  refreshed until the next event or reconnect. The provider could buffer recent events for late
  subscribers if it ever matters.
- **Realtime: a deferred refresh after a failed validation.** Submitting drops a deferred refresh
  because the action re-renders the page; a validation error does not re-render, so the page stays
  on the older version until the next event (a later submit gets the conflict flow).
- **"Last seen" on the detail page shows minutes** (the shared UTC date format). The live map's
  list and popups show a ticking relative time instead.
- **Map markers can overlap** when shipments are close (two trucks in one city). Fine for a
  small carrier; clustering (MapLibre's GeoJSON `cluster`) is the fix at fleet scale.
- **The map has no dark basemap.** Positron is light; popups are styled light in both themes.
- **The simulator only drives shipments with stop coordinates.** UI bookings have none (the form
  does not geocode), so a new booking joins the demo only if it is assigned to a driver and has
  coordinates; seeded pairs follow roads, others a straight line. Geocoding at booking would fix it.
- **Delivered demo shipments accumulate** between nightly resets (the simulator refills the fleet,
  see "Simulator refill" below). Fine for the list (paginated) and the map (unfinished only).
- **Simulator exceptions are coarse.** A 1 % chance per tick in transit, one per truck per run,
  always cleared after 5 ticks; no failed delivery attempts or returns.
- **Route fixture licence.** OSRM demo data is OpenStreetMap (ODbL); the attribution is in the
  fixture, and the map already credits OpenStreetMap. Re-fetching depends on the donated demo
  server's goodwill: keep it a rare, one-off run.

- **`changeShipmentStatus` has no injectable clock.** It checks event times against the real clock,
  so the simulator integration test starts its clock an hour in the past. Add `deps.now` (as in
  `createShipment` and `recordLocationPing`) early in Phase 3.

## Environment notes

- Node 22, pnpm 10. Global `tsc` 6.0.2 and Playwright 1.63.0 exist under `/opt/node22`, but project
  dependencies must be installed per project.
- PostgreSQL 16 (cluster `16/main`, port 5432) is installed but stopped: `service postgresql start`.
  Local role `waybill` / password `waybill` (dev only) owns `waybill` and `waybill_test`; the SQL is in
  `.env.example`.
- `.env` is gitignored; copy `.env.example` and generate `BETTER_AUTH_SECRET` with `openssl rand -base64 32`.
- Playwright: preinstalled chromium at `/opt/pw-browsers/chromium`
  (symlink to `/opt/pw-browsers/chromium-1243/chrome-linux64/chrome`). Never run `playwright install`.
- Docker is unavailable.
- **npm registry and NO_PROXY.** `registry.npmjs.org` is listed in `NO_PROXY`, but the container
  cannot resolve it directly, so plain `curl https://registry.npmjs.org` fails DNS. pnpm usually works;
  if an install fails with `ENOTFOUND`, re-run that one command with `registry.npmjs.org` removed from
  `NO_PROXY`, `no_proxy`, `npm_config_noproxy` and `GLOBAL_AGENT_NO_PROXY` so it goes through the
  agent proxy. Do not use mirrors or other registries.
- **More databases (created on first use, nothing to do by hand):** `waybill_demo_e2e` (the demo
  server of `pnpm test:e2e`, wiped and seeded by its command) and `waybill_demo_test` (the demo
  reset and tick integration tests; migrated every run, never wiped by the global setup). The role
  needs `CREATEDB` (already in `.env.example` and CI).
- **vercel.com and neon.com are not reachable from the build environment** (DNS fails; web search
  works). See the checkpoint 2 notes for what that meant for `docs/deployment.md`.
- The Postgres role, databases and `.env` survived a container restart in the same session; only
  the server needs restarting (`service postgresql start`). A brand-new cloud session may need them
  recreated.
