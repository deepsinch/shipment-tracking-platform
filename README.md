# Waybill

Shipment tracking and dispatch for small carriers. Dispatchers book shipments and move them through
a clear status flow, drivers update the shipments assigned to them, and customers follow a public
tracking page without an account.

It is a portfolio project, built to production standards: a strict state machine, an append-only
history enforced by the database, optimistic concurrency, multi-tenant isolation, and tests against
a real Postgres.

## Features (Phase 1)

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
- **Secure by default:** every query is scoped to your company, history is append-only in the
  database, and sign-in and sign-up are rate limited.

## Features (Phase 2: live tracking)

- **Driver app** (`/driver`): a phone-first list of the driver's own jobs, big buttons for the next
  status, and "Share my location" while a shipment is on the road.
- **Realtime:** the dashboard, detail pages and driver app update without a reload (Server-Sent
  Events fed by Postgres `LISTEN/NOTIFY`), with a Live indicator and no lost input while you type.
- **Live map** (`/dashboard/map`): every unfinished shipment at its last known position, coloured
  by status, gliding as drivers report, with a text list beside it.
- **Road routes:** the detail page draws the real driving route for the demo's city pairs, from
  committed OpenStreetMap routing fixtures (no routing service at runtime).
- **Truck simulator** (`pnpm simulate`): drives the demo trucks along those roads as their driver,
  through the same rules as a real phone, so the map moves.

Next up (Phase 3): a public API, webhooks, email notifications, proof of delivery and AI intake of
shipment requests (see the roadmap in [docs/implementation-notes.md](docs/implementation-notes.md)).

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
4. Apply migrations and load the demo data: `pnpm db:migrate && pnpm db:seed`
5. Start the app: `pnpm dev` and open http://localhost:3000

## Try it

The seed creates **Demo Freight Co** with 30 shipments in every status. All demo accounts use the
password `demo-password` (demo only):

| Account                | Role       | What to try                                                    |
| ---------------------- | ---------- | -------------------------------------------------------------- |
| `admin@demo.test`      | Admin      | Everything a dispatcher can do                                 |
| `dispatcher@demo.test` | Dispatcher | Create a shipment, assign the driver, move it through statuses |
| `driver@demo.test`     | Driver     | Sees only the shipments assigned to them; cannot cancel        |

1. Sign in as the dispatcher, open a shipment and change its status with a customer note and an
   internal note.
2. Click **Public tracking page**: the customer sees the note, never the internal one.
3. Open the same shipment in two tabs and change it in both: the second tab explains the conflict
   instead of overwriting.
4. Sign in as the driver to see the restricted view.

### Try the live demo locally

1. Load fresh demo data: `pnpm db:seed --reset` (local `waybill` database only).
2. Start the app: `pnpm dev` (or `pnpm build && pnpm start`).
3. Sign in at http://localhost:3000/sign-in as `dispatcher@demo.test` / `demo-password`.
4. In a second terminal, run `pnpm simulate`.
5. Open **Live map**: the trucks move every 12 seconds along real roads, go out for delivery near
   the address and are delivered (they then leave the map). Now and then one reports an exception
   and carries on a minute later. Open a shipment to see its route and live position, or its
   public tracking page to see the customer's view.

The simulator acts as each shipment's assigned driver through the app's own services, so it obeys
every rule a person does (it cannot cancel, it cannot ping faster than every 10 seconds). It also
picks up assigned shipments still waiting at the sender: assign the demo driver to a new shipment
booked between two demo cities and watch it join. Options: `--speed 60` (time compression, default
30), `--shipments 3`, `--seed 7`, `--once`. Ctrl+C stops it. When everything is delivered it says
so; reseed for another run.

The seed runs once (a re-run is a no-op, because history is never deleted). For fresh dates, run
`pnpm db:seed --reset`, which wipes and re-creates the local `waybill` database only.

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
| `pnpm db:seed`       | Load the demo data (`--reset` recreates the dev database)  |
| `pnpm auth:generate` | Regenerate the Better Auth tables (must be a no-op change) |
| `pnpm simulate`      | Drive the demo trucks so the live map moves (dev DB only)  |
| `pnpm routes:fetch`  | One-off: re-fetch the committed road route fixture (OSRM)  |

## Documentation

- [Architecture](docs/architecture.md): system design, state machine, multi-tenancy, decisions log.
- [Engineering notes](docs/engineering-notes.md): the problems worth discussing and the tradeoffs.
- [Implementation notes](docs/implementation-notes.md): status, roadmap, gotchas, environment.
