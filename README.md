# Waybill

Shipment tracking and dispatch for small carriers. Dispatchers book shipments and move them through
a clear status flow, drivers update the shipments assigned to them, and customers follow a public
tracking page without an account.

It is a portfolio project, built to production standards: a strict state machine, an append-only
history enforced by the database, optimistic concurrency, multi-tenant isolation, and tests against
a real Postgres.

## Features so far (Phase 1, in progress)

- **Accounts and companies:** sign up creates a company workspace with you as admin. Roles: admin,
  dispatcher, driver.
- **Shipments list:** search by tracking code or reference, filter by status, URL-based pagination.
- **Create shipments:** validated form with field-level errors, optional driver assignment, and an
  unguessable tracking code (`WB-XXXX-XXXX`).
- **Shipment detail:** addresses, recipient, driver, the full history with who changed what, and
  internal notes.
- **Status changes:** only the transitions the state machine and your role allow. If someone else
  changed the shipment first, you see what changed and can retry, instead of silently overwriting.
- **Public tracking page:** mobile-first status, progress, route and timeline. Never shows
  addresses, internal notes or staff names; not indexed by search engines.

Coming next: a demo seed with ready-made accounts, then a driver app, live map, public API and
webhooks (see the roadmap in [docs/implementation-notes.md](docs/implementation-notes.md)).

## Stack

Next.js 16 (App Router, Server Actions, Cache Components) with TypeScript strict, PostgreSQL 16 with
Drizzle ORM, Better Auth (email/password and organizations), Tailwind CSS with shadcn/ui, Zod,
Vitest and Playwright. pnpm and Node 22.

## Local setup

Prerequisites: Node 22, pnpm 10, PostgreSQL 16.

1. Install dependencies: `pnpm install`
2. Create the database role and databases (as the `postgres` superuser, e.g. `sudo -u postgres psql`):

   ```sql
   CREATE ROLE waybill WITH LOGIN PASSWORD 'waybill' CREATEDB;
   CREATE DATABASE waybill OWNER waybill;
   CREATE DATABASE waybill_test OWNER waybill;
   ```

   The e2e database (`waybill_e2e`) is created automatically by `pnpm test:e2e`.

3. Configure the environment: `cp .env.example .env`, then set `BETTER_AUTH_SECRET`
   (`openssl rand -base64 32`).
4. Apply migrations: `pnpm db:migrate`
5. Start the app: `pnpm dev`, open http://localhost:3000 and create an account.

> **Demo data:** a re-runnable seed ("Demo Freight Co") with demo accounts for each role arrives
> with the next checkpoint. Until then, sign up to create your own company.

### Tests

- `pnpm test` runs unit tests and integration tests. Integration tests need Postgres running; they
  wipe and re-migrate `TEST_DATABASE_URL` (the name must end in `_test`).
- `pnpm test:e2e` runs Playwright. It creates (if needed), wipes and migrates `E2E_DATABASE_URL`
  (the name must end in `_e2e`), builds the app and starts it on port 3100 against that database.
  It uses `PLAYWRIGHT_CHROMIUM` if set, then `/opt/pw-browsers/chromium` if present, otherwise
  the browser from `pnpm exec playwright install chromium`.

## Scripts

| Script               | Purpose                                                    |
| -------------------- | ---------------------------------------------------------- |
| `pnpm dev`           | Next.js dev server                                         |
| `pnpm build`         | Production build                                           |
| `pnpm start`         | Serve the production build                                 |
| `pnpm lint`          | ESLint                                                     |
| `pnpm typecheck`     | Generate route types, then `tsc --noEmit`                  |
| `pnpm format:check`  | Prettier check (`pnpm format` to fix)                      |
| `pnpm test`          | Vitest: unit and integration tests                         |
| `pnpm test:e2e`      | Playwright end-to-end tests against a production build     |
| `pnpm db:generate`   | Generate a migration from the Drizzle schema               |
| `pnpm db:migrate`    | Apply migrations to `DATABASE_URL`                         |
| `pnpm auth:generate` | Regenerate the Better Auth tables (must be a no-op change) |

## Documentation

- [Architecture](docs/architecture.md): system design, state machine, multi-tenancy, decisions log.
- [Engineering notes](docs/engineering-notes.md): the problems worth discussing and the tradeoffs.
- [Implementation notes](docs/implementation-notes.md): status, roadmap, gotchas, environment.
