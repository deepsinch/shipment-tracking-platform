# Implementation notes

Handoff log for whoever continues the work. Update it at the end of every phase and whenever you
learn something a newcomer would trip over. Design rationale lives in `docs/architecture.md`.

## Current status

**Phase 1 (core) in progress on branch `phase-1-core`.**

Work proceeds in reviewable checkpoints: (1) scaffold + tooling, (2) DB, (3) auth,
(4) services + integration tests, (5) UI, (6) seed + e2e + README + docs. Finish one, get it green,
commit, stop for architect review.

**Checkpoint reached: 1 (scaffold + tooling).** lint, typecheck, test (51 domain tests under real
Vitest) and build pass.

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
- [ ] Remaining scripts: `db:generate`, `db:migrate` (checkpoint 2), `db:seed` (6), `test:e2e` with
      Playwright `executablePath` (6; first e2e run from checkpoint 5).
- [ ] Drizzle schema: Better Auth tables (user, session, account, verification, organization, member,
      invitation), `shipments`, `shipment_events`, indexes for org-scoped listing and status filtering.
- [ ] Migration with a trigger that raises on UPDATE/DELETE of `shipment_events`. Migrations committed.
- [ ] Better Auth: email/password + organization plugin, roles admin/dispatcher/driver; sign-up creates
      a user plus a new org where they are admin; sign-in, sign-out; session helper returning
      `AuthContext` or redirecting; protection for `/dashboard`.
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

## Known issues / TODOs

- None open at checkpoint 1.

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
