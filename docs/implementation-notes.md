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

**Phase 2 (live tracking) is in progress on branch `phase-2-live-tracking`.** Checkpoint 1 is
reached: format:check, lint, typecheck, test (85 unit + 122 integration), build and test:e2e
(6 specs) pass. **Next: checkpoint 2 (location pings).** The design is in `docs/architecture.md`,
"Phase 2: live tracking"; follow it. Checkpoints, each green and reviewed:

1. **[done] Driver app and reassignment.** `/driver` (mobile-first, assigned shipments, big-button status
   flow via `statusOptionsFor`), role-based landing after sign-in, `assignDriver` service with a
   `driver_assigned` event, and the public timeline restricted to customer-facing event types by an
   allow-list (with a test). E2E: a driver signs in, lands on `/driver`, advances a shipment.
2. **Location pings.** `location_pings` + `shipment_positions` (migration with composite FKs and
   CHECKs), `recordLocationPing` (driver-only, assigned-only, active statuses, 10 s throttle,
   future-time rejection, stale pings don't move the position), a positions snapshot service
   (org-scoped), and the driver app sending pings via the Geolocation API while a shipment is active.
3. **Realtime.** `RealtimeBus` with the Postgres `LISTEN`/`pg_notify` implementation on
   `DATABASE_DIRECT_URL`, `pg_notify` inside status, assignment and ping transactions, an SSE route
   handler with auth and org/driver filtering, self-closing before the function time limit, and
   client hooks that `router.refresh()` or update positions. Integration tests: notifications only
   on commit, cross-org isolation on the stream.
4. **Live map.** MapLibre + OpenFreeMap, client-only; dashboard map of active shipments, detail-page
   map with route and latest position; markers update from SSE. E2E with tile requests blocked.
5. **Truck simulator.** OSRM route fixtures for the seed's city pairs (committed), a simulator
   script driving active shipments through the services. Phase 2 e2e: a driver advances a shipment
   and the dashboard updates without a reload.

## Roadmap

- **Phase 2 (next):** driver app, location pings, live map (MapLibre + OpenStreetMap), realtime
  via SSE, truck simulator. Checkpoints above.
- **Phase 3:** public API with API keys, signed and retried webhooks, email notifications via Resend,
  proof of delivery (photo + signature), AI intake of shipment request emails.
- **Phase 4:** test coverage, CI with GitHub Actions, README with architecture diagram,
  accessibility + Lighthouse pass, deploy to Vercel + Neon (demo accounts already exist via the
  seed).

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

## Known issues / TODOs

- User deletion fails with an FK error once the user has created shipments or events (by design).
  Org deletion is disabled in Better Auth (`disableOrganizationDeletion`).
- Sign-up is two Better Auth calls (user, then org) that cannot share a DB transaction; on org
  failure the user is deleted again (compensation), but a crash between the two would leave an
  org-less user, who can sign in but gets redirected away from `/dashboard`.
- Only one organization per user is supported in the UI (no org switcher).
- **Rate-limit rows are never purged.** Expired windows are overwritten on the next attempt for
  the same key, but keys that never come back stay. Add a periodic
  `DELETE FROM auth_rate_limits WHERE window_start < now() - interval '1 day'` (cron) when deployed.
- **The client IP trusts `x-forwarded-for`.** Correct behind Vercel or another proxy that sets it;
  a self-hosted deployment without such a proxy lets clients choose their IP for the per-IP limits
  (the per-account sign-in limit still holds per IP chosen). Documented in `client-ip.ts`.
- **Distributed password guessing.** The per-account sign-in limit is keyed on email + IP, so an
  attacker rotating many IPs gets 5 guesses per IP per account. A per-email limit (any IP) would stop
  that but lets anyone lock a victim out. Planned fix: a looser per-email cap (e.g. 20/hour) plus
  breached-password checks at sign-up; at scale, CAPTCHA after repeated failures.
- **Seeded dates age.** The demo seed is a one-off; rerun `pnpm db:seed --reset` locally for fresh
  "recent" dates. A hosted demo will need a scheduled reset (Phase 4).
- `notFound()` on dynamic pages streams a 200 with `noindex` (see checkpoint 5b gotchas).
- Sign-up says when an email is already registered (account enumeration). Accepted for now as a
  product choice; revisit with email verification in Phase 3 ("check your email" response).
- An org-less user (see sign-up above) is sent to `/sign-in` while still signed in, which is
  confusing. A dedicated "no organization" page would be clearer.
- **Driver buttons have no confirmation (fix in Phase 2 checkpoint 2).** "Mark as delivered" is
  terminal and one tap away on a phone, and nobody can undo it. Architect decision: terminal
  statuses (delivered, cancelled) get a confirm step in both surfaces until proof of delivery
  (Phase 3) replaces it for delivery.
- **Drivers see internal notes and other drivers' names in the history** (getShipment returns the
  organization's full history to any member who can see the shipment). Architect decision: keep.
  Internal means "inside the company", and office notes such as gate codes are for drivers. Revisit
  only if notes ever need a staff-only level.
- **Wrong-surface redirects are client-side** (see checkpoint 1 gotchas). A role-aware proxy
  would need the role in the session cookie, which conflicts with decision 8.

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
- The Postgres role, databases and `.env` survived a container restart in the same session; only
  the server needs restarting (`service postgresql start`). A brand-new cloud session may need them
  recreated.
