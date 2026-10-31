# Implementation notes

Handoff log for whoever continues the work. Update it at the end of every phase and whenever you
learn something a newcomer would trip over. Design rationale lives in `docs/architecture.md`.

## Current status

**Phase 1 (core) in progress on branch `phase-1-core`.**

Done:

- `docs/architecture.md` (the spec).
- Domain modules with unit tests: `src/domain/shipment-status.ts`, `src/domain/tracking-code.ts`
  and their `*.test.ts` files. Verified only with strict `tsc` and a throwaway `node:test` shim
  (51 passing, plus a mutation check). **They must be re-run under real Vitest** once dependencies install.
- `.env.example` (database URLs, Better Auth secret/URL) and the local database setup steps in it.

Blocked: npm registry access (see Known issues). Nothing below can start until it works.

Next (remaining Phase 1 scope, from the original brief):

- [ ] Scaffold Next.js with `pnpm create next-app@latest` (TypeScript, App Router, `src/`, Tailwind, ESLint)
      into a temp dir, then move the files in, keeping `.gitignore` entries, README and docs.
- [ ] Tooling: TypeScript strict, ESLint, Prettier, scripts (`dev`, `build`, `lint`, `typecheck`, `test`,
      `test:e2e`, `db:generate`, `db:migrate`, `db:seed`), Vitest, Playwright with `executablePath`.
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

## Known issues / TODOs

- **npm registry blocked.** `registry.npmjs.org` does not resolve from the container, and the egress proxy
  answered 403 when tried. The network policy must allow `registry.npmjs.org` (environment settings,
  Network access); the change may only apply in a new session. Do not use mirrors or other registries.
- Domain tests have not yet run under real Vitest.

## Environment notes

- Node 22, pnpm 10. Global `tsc` 6.0.2 and Playwright 1.63.0 exist under `/opt/node22`, but project
  dependencies must be installed per project.
- PostgreSQL 16 (cluster `16/main`, port 5432) is installed but stopped: `service postgresql start`.
  Local role `waybill` / password `waybill` (dev only) owns `waybill` and `waybill_test`; the SQL is in
  `.env.example`. A new cloud session starts with a fresh container, so recreate them there.
- `.env` is gitignored; copy `.env.example` and generate `BETTER_AUTH_SECRET` with `openssl rand -base64 32`.
- Playwright: preinstalled chromium at `/opt/pw-browsers/chromium`
  (symlink to `/opt/pw-browsers/chromium-1243/chrome-linux64/chrome`). Never run `playwright install`.
- Docker is unavailable.
