# CLAUDE.md

## Project

Waybill is a multi-tenant shipment tracking and dispatch platform for small carriers: dispatchers
create and manage shipments, drivers update them, and customers follow a public tracking page.
It is a portfolio project for a full-stack Next.js job search, so hiring managers will read the code.
Code quality, clarity and correctness matter more than speed.

## Read first

1. `docs/architecture.md`: system design, state machine, multi-tenancy, decisions log.
2. `docs/implementation-notes.md`: current status, next steps, gotchas, environment notes.

## Stack

Next.js (App Router) + TypeScript strict, PostgreSQL 16 + Drizzle ORM (drizzle-kit migrations, committed),
Better Auth (email/password + organization plugin), Tailwind CSS + shadcn/ui, Zod, Vitest, Playwright.
pnpm is the package manager; Node 22.

## Code layout and rules

```
src/
  app/          routes only: pages, layouts, route handlers, server action wiring
  domain/       pure business logic, no I/O (status machine, tracking codes)
  server/db/    drizzle schema, client, migrations
  server/services/  use cases: auth check -> validation -> transaction -> result
  server/auth/  Better Auth config and session helpers
  components/   UI components
```

- Routes stay thin: they call a service. Services own authorization and transactions.
- Domain code is pure so it is unit tested without a database.
- The organization always comes from the server-side session (`AuthContext { userId, organizationId, role }`),
  never from client input. Every tenant query filters by `organizationId`; cross-org lookups return not found.
- Validate with Zod at every trust boundary (forms, Server Actions, later the public API).
- Status changes: state machine check + optimistic concurrency (`version`) + event insert in one transaction.
  `shipment_events` is append-only (DB trigger rejects UPDATE/DELETE).

## Workflow

- The main session acts as architect and reviewer.
- Implementation is delegated to an Opus subagent at medium effort.
- One branch per phase (`phase-N-<name>`), small logical commits, PR to `main` after review.
- The implementor commits locally; the architect reviews, then pushes.

## Commits

- Conventional-style messages (`feat(domain): ...`, `fix: ...`, `docs: ...`, `chore: ...`).
- The author is the repo owner; the committer is Claude, so the commit signature matches the committer
  and GitHub shows commits as Verified. In a fresh clone, set repo-local config:
  ```
  git config author.name "deepsinch"
  git config author.email "56645980+deepsinch@users.noreply.github.com"
  git config committer.name "Claude"
  git config committer.email "noreply@anthropic.com"
  ```
  Check with `git log -1 --format='%an <%ae> / %cn <%ce> / sig:%G?'` after the first commit.
- Every commit message ends with these two trailer lines (the session URL changes per session; use the current one):
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/<current session id>
  ```
- Never commit `.env` or secrets. Never rewrite pushed history.

## Environment

- Postgres 16 is installed but stopped: `service postgresql start`, then create the role and the
  `waybill` / `waybill_test` databases with the SQL in `.env.example`. Copy `.env.example` to `.env`.
- Playwright: use the preinstalled chromium at `/opt/pw-browsers/chromium`
  (via `launchOptions.executablePath`). Never run `playwright install`.
- Docker is unavailable.
- Installing packages requires the environment's network policy to allow `registry.npmjs.org`.
  Check with `curl -sS -o /dev/null -w "%{http_code}" https://registry.npmjs.org/next` (expect 200).

## Commands (planned; NOT yet scaffolded, no package.json exists yet)

| Script | Purpose |
|---|---|
| `pnpm dev` | Next.js dev server |
| `pnpm build` | Production build |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest unit + integration (integration uses `TEST_DATABASE_URL`) |
| `pnpm test:e2e` | Playwright end-to-end |
| `pnpm db:generate` | drizzle-kit generate migrations |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:seed` | Re-runnable demo seed ("Demo Freight Co") |

Done criteria for every phase: lint, typecheck, test, build and test:e2e all pass.
