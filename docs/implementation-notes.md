# Implementation notes

Handoff log for whoever continues the work. Update it at the end of every phase and whenever you
learn something a newcomer would trip over. Design rationale lives in `docs/architecture.md`.

## Current status

**Phase 1 (core) in progress on branch `phase-1-core`.**

Work proceeds in reviewable checkpoints: (1) scaffold + tooling, (2) DB, (3) auth,
(4) services + integration tests, (5) UI, (6) seed + e2e + README + docs. Finish one, get it green,
commit, stop for architect review.

**Checkpoint reached: 3 (auth).** format:check, lint, typecheck, test (53 unit + 24 integration) and
build pass. Next: checkpoint 4 (services + integration tests).

Done:

- `docs/architecture.md` (the spec).
- Domain modules with unit tests: `src/domain/shipment-status.ts`, `src/domain/tracking-code.ts`
  and their `*.test.ts` files, now running under Vitest.
- `.env.example` (database URLs, Better Auth secret/URL) and the local database setup steps in it.

Next (remaining Phase 1 scope, from the original brief):

- [x] Scaffold Next.js with `pnpm create next-app@latest` (TypeScript, App Router, `src/`, Tailwind, ESLint)
      into a temp dir, then move the files in, keeping `.gitignore` entries, README and docs.
- [x] Tooling: TypeScript strict, ESLint, Prettier, Vitest, scripts `dev`, `build`, `lint`, `typecheck`,
      `test`, `format`.
- [x] DB scripts: `db:generate`, `db:migrate`, plus `auth:generate` (regenerates the Better Auth schema).
- [ ] Remaining scripts: `db:seed` (checkpoint 6), `test:e2e` with Playwright `executablePath`
      (first e2e run from checkpoint 5).
- [x] Drizzle schema: Better Auth tables (user, session, account, verification, organization, member,
      invitation), `shipments`, `shipment_events`, indexes for org-scoped listing and status filtering.
- [x] Migration with a trigger that raises on UPDATE/DELETE (and TRUNCATE) of `shipment_events`.
      Migrations committed in `src/server/db/migrations/`.
- [x] Integration test project against `waybill_test`, with the append-only trigger tests.
- [x] DB review fixes: migration 0002 (composite tenant FK on events, CHECK constraints) with tests;
      lazy `getDb()` so importing the client needs no env vars.
- [x] Better Auth: email/password + organization plugin, roles admin/dispatcher/driver; sign-up creates
      a user plus a new org where they are admin; sign-in, sign-out; session helper returning
      `AuthContext` or redirecting; protection for `/dashboard`. Pages are unstyled placeholders.
- [ ] Services in `src/server/services/`: `createShipment`, `listShipments` (pagination, status filter,
      search by code or reference), `getShipment`, `changeShipmentStatus` (one transaction; result union
      ok / invalid_transition / conflict / not_found), `getPublicTracking(code)` (safe projection only).
      Drivers cannot create shipments in Phase 1.
- [ ] UI: `/`, `/sign-in`, `/sign-up`, `/dashboard/shipments` (table, filter, search, URL-param pagination),
      `/dashboard/shipments/new` (Zod + Server Action, field errors), `/dashboard/shipments/[id]`
      (details, timeline, status form with only allowed next statuses, conflict handling),
      `/track/[code]` (public, `generateMetadata`, noindex, friendly not-found).
- [ ] Seed: "Demo Freight Co", admin@/dispatcher@/driver@demo.test, ~30 shipments across all statuses
      with valid event histories and real city coordinates; re-runnable.
- [ ] Integration tests against `waybill_test`: changeShipmentStatus (happy path, invalid transition,
      stale version conflict, cross-org not_found) and the append-only trigger.
- [ ] Playwright happy path: dispatcher signs in, creates a shipment, advances status, opens the public page.
- [ ] README: features, stack, setup, demo credentials, scripts, link to architecture.
- [ ] Run all done criteria: lint, typecheck, test, build, test:e2e.

## Roadmap

- **Phase 2:** driver app, location pings, live map (MapLibre + OpenStreetMap), realtime via SSE,
  truck simulator.
- **Phase 3:** public API with API keys, signed and retried webhooks, email notifications via Resend,
  proof of delivery (photo + signature), AI intake of shipment request emails.
- **Phase 4:** test coverage, CI with GitHub Actions, README with architecture diagram,
  accessibility + Lighthouse pass, demo accounts, deploy to Vercel + Neon.

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

### Testing

- `pnpm test` runs two Vitest projects: `unit` (`src/**/*.test.ts`) and `integration`
  (`src/**/*.integration.test.ts`).
- Integration tests need **Postgres running** (`service postgresql start`) and **`.env` with
  `TEST_DATABASE_URL`**. The global setup (`tests/integration/global-setup.ts`) drops and recreates
  the `public` and `drizzle` schemas of that database, then applies every committed migration. It
  refuses to run unless the database name ends in `_test`.
- For code under test, `DATABASE_URL` is overridden to `TEST_DATABASE_URL`. Files run serially.
- Tests never clean up: fixtures use random ids, so tests are isolated without deleting rows
  (history rows cannot be deleted anyway).

## Known issues / TODOs

- User deletion fails with an FK error once the user has created shipments or events (by design).
  Org deletion is disabled in Better Auth (`disableOrganizationDeletion`).
- Sign-up is two Better Auth calls (user, then org) that cannot share a DB transaction; on org
  failure the user is deleted again (compensation), but a crash between the two would leave an
  org-less user, who can sign in but gets redirected away from `/dashboard`.
- Only one organization per user is supported in the UI (no org switcher).

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
