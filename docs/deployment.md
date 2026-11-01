# Deploying Waybill (Vercel + Neon)

This is the owner's guide to putting the public demo online: a URL anyone can open, with demo
accounts one click away and trucks that move on the live map. It takes about 20 minutes and costs
nothing on the free plans (see "Plan limits" at the end).

You do everything in two dashboards, Vercel and Neon, in your browser. **Never paste a secret
anywhere except the Vercel dashboard** (not into a chat, an issue, a commit or a message). Secrets
are generated on your own computer with the commands below and go straight into Vercel's
"Environment Variables" form.

## Checklist

Tick these off as you go. Each item is explained in the numbered steps below.

- [ ] 1. Vercel account created (Hobby plan, sign in with GitHub)
- [ ] 2. Neon account created (optional but useful: it lets you look inside the database)
- [ ] 3. GitHub repository imported as a Vercel project (do not click Deploy yet)
- [ ] 4. Neon added from the Vercel Marketplace, connected to the project, preview branching on
- [ ] 5. Name of the Neon database noted (usually `neondb`)
- [ ] 6. `BETTER_AUTH_SECRET` generated and added in Vercel
- [ ] 7. `CRON_SECRET` generated and added in Vercel
- [ ] 8. `DEMO_MODE=true` and `DEMO_RESET_DATABASES=<database name>` added in Vercel
- [ ] 9. First deploy finished (green)
- [ ] 10. Verified: banner, one-click sign-in, moving trucks, protected reset endpoint, cron job listed
- [ ] 11. Live URL put in the README ("Live demo" link)

## What gets deployed

- **Vercel** runs the Next.js app. Every push to `main` deploys to production; every pull request
  gets its own preview URL.
- **Neon** is the PostgreSQL database. The integration puts two connection strings into the
  project: `DATABASE_URL` (pooled, for queries) and `DATABASE_URL_UNPOOLED` (direct, for
  migrations and the live-update listener). The app finds both by itself.
- On every deploy Vercel runs `pnpm vercel-build` (set in `vercel.json`): it checks the
  environment, applies database migrations, creates the demo data when `DEMO_MODE=true` (only if
  it is not there yet) and builds the app. If any step fails, the deploy fails and the previous
  version keeps serving.
- A daily cron job (03:00 UTC) wipes and recreates the demo data, so the demo never fills up with
  strangers' test data.
- While someone has the live map or a shipment page open, the browser asks the server to move the
  demo trucks one step every ~12 seconds. Nothing runs when nobody is looking. When fewer than 6
  shipments are left to drive, the same tick books up to 2 new ones as the demo dispatcher, so the
  map keeps trucks on it all day; the nightly reset clears them with the rest.

## 1. Create the accounts

1. Go to <https://vercel.com/signup>, choose **Hobby** (free, for personal projects) and
   **Continue with GitHub**. Authorize Vercel for your GitHub account.
2. Go to <https://neon.com> and sign up (**Continue with GitHub** is the quickest). If you skip
   this, the Vercel Marketplace step below creates a Neon account for you; having your own login
   just makes it easy to browse tables and branches later.

## 2. Import the repository (do not deploy yet)

1. In Vercel, click **Add New…** then **Project**.
2. Under **Import Git Repository**, find the Waybill repository and click **Import**. (If it is
   missing, click **Adjust GitHub App Permissions** and give Vercel access to the repository.)
3. On the configuration screen leave **Framework Preset** as **Next.js**. The build command comes
   from `vercel.json`; there is nothing to change.
4. **Do not click Deploy yet.** The first build needs the database and the variables from the next
   steps; without them it stops at the environment check, which is harmless but noisy. If the
   screen only offers Deploy, deploy anyway: it fails at "validate environment", and you will
   **Redeploy** in step 7.

## 3. Add Neon from the Marketplace

1. In the Vercel project (or the team dashboard) open **Storage**, click **Create Database** (or
   **Browse Marketplace**) and choose **Neon** (Postgres).
2. Accept the terms, choose the free plan, pick a region close to your Vercel functions (the
   default Vercel region is Washington, D.C., `iad1`, so a US East region), and give the database
   a name.
3. When asked which project to connect, pick the Waybill project and tick **Production** and
   **Preview** (leave Development unticked).
4. Find the option to **create a database branch for each preview deployment** (named something
   like "Preview branches" / "Create a branch for each preview deployment") and turn it on. Each
   pull request then gets its own copy of the database, so previews never touch production data.
5. Finish. Open the project's **Settings → Environment Variables** and check that `DATABASE_URL`
   and `DATABASE_URL_UNPOOLED` now exist. Do not edit them.

Note the **database name**: it is the last part of the connection string, after the host and
before any `?`. In Neon's console it is under your project, **Branches → Databases** (or the
**Dashboard**'s connection details). With the integration it is usually `neondb`. You need it in
step 5 below. (If you guess wrong, nothing is lost: the deploy stops with the exact name in the
message, see Troubleshooting.)

## 4. Generate the secrets (on your own computer)

Run these in a terminal on your own machine and keep the output on screen only long enough to
paste it into Vercel in the next step. Do not save it in a file in the repository.

```
openssl rand -base64 32     # BETTER_AUTH_SECRET
openssl rand -hex 32        # CRON_SECRET
```

No `openssl`? This does the same with Node, which you already have for the project:

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # BETTER_AUTH_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"      # CRON_SECRET
```

## 5. Add the environment variables

In Vercel open the project, then **Settings → Environment Variables**. For each row: type the
**Key**, paste the **Value**, tick **Production** and **Preview** (not Development), and click
**Save**. For the two secrets, switch on **Sensitive** if the form offers it: Vercel then never
shows the value again.

| Key                       | Value                                                      | Why                                                                                                                                                             |
| ------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`      | the output of the first command (44 characters)            | Signs session cookies. Changing it later signs everyone out.                                                                                                    |
| `DEMO_MODE`               | `true`                                                     | Turns on the banner, the one-click demo sign-in, the moving trucks and the nightly reset, and creates the demo data on deploy.                                  |
| `CRON_SECRET`             | the output of the second command (64 characters)           | Vercel Cron sends it as `Authorization: Bearer …` to the reset endpoint, which refuses everything else. Required when `DEMO_MODE=true`, at least 16 characters. |
| `DEMO_RESET_DATABASES`    | the database name from step 3, e.g. `neondb`               | The nightly reset may only wipe a database named here, so it can never hit one you did not mean. Required when `DEMO_MODE=true`.                                |
| `BETTER_AUTH_URL`         | _leave unset_ (set it only for a custom domain, see below) | On Vercel the app's address is worked out from the deployment, for production and for every preview.                                                            |
| `REALTIME_STREAM_SECONDS` | _leave unset_                                              | Only needed if your plan's function time limit is under 300 seconds.                                                                                            |

Variables you do **not** add: `DATABASE_URL`, `DATABASE_URL_UNPOOLED` (from Neon), anything
starting with `VERCEL_` (from Vercel).

## 6. Deploy

1. Open **Deployments**. If a failed first deploy is listed, open its **⋯** menu and choose
   **Redeploy**; otherwise push any commit to `main`, or click **Deploy** on the import screen.
2. Click the running deployment and watch **Build Logs**. A good build prints these headings in
   order, each ending with a check mark:

   ```
   ▸ validate environment
   ▸ migrate        (direct connection)
   ▸ seed           Seeded 30 shipments for Demo Freight Co
   ▸ build
   ```

   The first deploy seeds; later deploys print "Demo data already present … nothing to do".

3. When the status turns **Ready**, click **Visit**.

## 7. Verify

Work through this list on the live URL (the project's **Domains** list shows the production one,
`https://<project>.vercel.app`):

- [ ] The yellow banner "Demo · data resets nightly around 03:00 UTC" is at the top; the **×**
      hides it for the rest of the browser session.
- [ ] `/sign-in` shows a "Try the demo" card with three buttons. **Sign in as dispatcher** lands
      on the shipment list; **Sign in as driver** lands on the phone-style driver app.
- [ ] Signed in as dispatcher, open **Live map**. Within about 15 seconds the trucks start moving
      (and the **Live** pill in the header is green). Open a shipment: its route map follows too.
- [ ] Open `https://<your-url>/api/cron/reset-demo` in a browser tab. It must show a blank page
      or "401": the reset endpoint refuses anyone without the secret.
- [ ] **Settings → Cron Jobs** in the project lists `/api/cron/reset-demo` with schedule
      `0 3 * * *`. Its **Run** button (if shown) triggers the reset on demand: the demo data
      comes back to its original state and everyone is signed out. After the next 03:00 UTC, check
      the entry in **Logs** (filter on the path) to see it ran. (On the Hobby plan, daily jobs run
      at some point within the scheduled hour.)
- [ ] Open a pull request: its preview comment shows a URL, and the preview works the same way
      with its own database branch.

Then replace the placeholder in the README ("Live demo") with your production URL.

## Custom domain (optional)

1. **Settings → Domains → Add**, enter the domain, follow the DNS instructions at your registrar.
2. Add one more environment variable, `BETTER_AUTH_URL`, set to the domain with `https://`, e.g.
   `https://waybill.example.com` (Production only), and **Redeploy**. The app still accepts
   requests on the `*.vercel.app` addresses too.

## Turning demo mode off

Demo mode is a deployment setting. To switch it off:

1. **Settings → Environment Variables**: set `DEMO_MODE` to `false` (or delete it), and delete
   `CRON_SECRET` and `DEMO_RESET_DATABASES` if you like.
2. **Redeploy** (variables only apply to new deployments).

Afterwards the banner and demo buttons are gone, `/api/demo/tick` and `/api/cron/reset-demo`
answer 404, the nightly job still fires but gets a 404 and does nothing, and the existing data
stays as it is. To also remove the job, delete the `crons` entry in `vercel.json` and push.
Anyone can still sign up and create their own company; the demo accounts keep working with their
published password until you delete them, so for a real deployment start from a fresh database.

## Troubleshooting

**The build fails at "validate environment".** The log lists every missing or malformed variable
at once, naming it (never its value). Fix them under **Settings → Environment Variables**, then
**Redeploy**. Typical: a variable ticked for Production but not Preview (or the reverse);
`CRON_SECRET` shorter than 16 characters; `BETTER_AUTH_SECRET` shorter than 32.

**The build fails with `Refusing to use "xxx": it is not listed in DEMO_RESET_DATABASES`.** The
database the integration created is called `xxx`, not what you entered. Set
`DEMO_RESET_DATABASES` to exactly `xxx` and redeploy. (Several databases can be listed, separated
by commas.)

**The build fails at "migrate".** The error follows the heading. A deploy that fails here is never
promoted, so the previous version keeps serving; Drizzle applies the pending migrations in one
transaction, so nothing is left half done. Common causes: `DATABASE_URL_UNPOOLED` missing for this
environment (Storage → the Neon database → check it is connected to Production and Preview), or
the Neon project is suspended. Fix and **Redeploy**. If the message is an SQL error, the
migration itself is wrong: migrations must be backward compatible with the release that is still
serving (add first, remove in a later release), so the fix goes in the code, not the dashboard.

**The Live indicator stays on "Connecting" or "Reconnecting", and nothing updates by itself.** The
realtime stream needs the direct connection (`LISTEN` does not work through Neon's pooler). The
integration's `DATABASE_URL_UNPOOLED` is used automatically; if you set `DATABASE_DIRECT_URL`
yourself it wins, so check it does not contain `-pooler` in the host name. Also check the
environment has `DATABASE_URL_UNPOOLED` at all (Settings → Environment Variables, filter by
Preview or Production). The function logs for `/api/realtime` show the connection error.

**Pages are blank or maps and fonts are missing, and the browser console says "Refused to
connect/load … Content Security Policy".** The app only talks to itself and to
`tiles.openfreemap.org`. If you added anything that loads from another origin (analytics, an image
host), allow it in `src/lib/security-headers.ts` (the right directive), run `pnpm test:e2e`
(`security-headers.spec.ts` walks every page and fails on any violation) and redeploy.

**Sign-in fails with "Invalid origin" (or forms do nothing) on a custom domain.** Set
`BETTER_AUTH_URL` to the domain (see Custom domain) and redeploy.

**The trucks do not move.** The tick runs only while the live map or a shipment page is open,
in a visible tab, signed in as a member of Demo Freight Co. In the browser's Network tab you
should see a `POST /api/demo/tick` about every 12 seconds, answering `{"ran":true,…}` or
`{"ran":false,"reason":"throttled"}` (another viewer's tick ran moments ago: fine). A 404 means
demo mode is off in that deployment, a 403 means you signed in to another company. If every truck
is already delivered, the next ticks book new shipments (up to two per tick, until six are on
the road), so the map refills within a minute of viewing. If it stays empty, check the Vercel
function logs of `/api/demo/tick` for a refused booking (the demo dispatcher account missing).

**The nightly job does not run.** Cron jobs run only on **production** deployments, so a preview
never resets. On the Hobby plan a daily job may run at any time within its scheduled hour.

## Test the build on your own machine (for developers)

`pnpm vercel-build` reads the environment as given (no `.env` file), so you can rehearse a deploy
against a scratch database:

```
createdb -h localhost -U waybill waybill_deploy_check
DATABASE_URL=postgres://waybill:waybill@localhost:5432/waybill_deploy_check \
BETTER_AUTH_SECRET="$(openssl rand -base64 32)" BETTER_AUTH_URL=http://localhost:3000 \
DEMO_MODE=true CRON_SECRET="$(openssl rand -hex 16)" DEMO_RESET_DATABASES=waybill_deploy_check \
pnpm vercel-build
```

Run it twice: the second run's seed step says the data is already there. Drop the scratch
database afterwards.

## Plan limits worth knowing

- **Vercel Hobby:** daily cron jobs only, with timing precision of an hour; functions may run up
  to 300 seconds with Fluid compute, which the live-update stream relies on (it closes itself
  after 270 seconds and the browser reconnects). Hobby is for non-commercial use.
- **Neon free plan:** the database suspends when idle, so the first request after a quiet period is
  slower. An open live-update stream is an open connection, so a busy demo keeps the database
  awake and uses up compute hours: check the current free-plan allowance on Neon's pricing page.
- Both plans' limits change; the pages below are the source of truth.

## Sources

Checked on 2026-11-01. Read this note before trusting the list: while writing this guide the
build environment could not reach `vercel.com` or `neon.com` (DNS lookups for both hosts failed,
`getaddrinfo ENOTFOUND`), so **the pages could not be opened directly**. The statements below come
from the search engine's summaries of these pages and agree with how the code behaves when run
locally; verify the starred ones in the live docs before relying on them.

| Topic                                                                                                                                 | Page                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `CRON_SECRET` is sent as `Authorization: Bearer <value>` on cron requests; Hobby crons run at most once a day                         | <https://vercel.com/docs/cron-jobs/manage-cron-jobs>                                                                  |
| Hobby cron limits: number of jobs\*, timing within the hour\*                                                                         | <https://vercel.com/docs/cron-jobs/usage-and-pricing>                                                                 |
| `VERCEL_URL`, `VERCEL_BRANCH_URL`, `VERCEL_PROJECT_PRODUCTION_URL` hold a host **without** `https://`; available at build and runtime | <https://vercel.com/docs/environment-variables/system-environment-variables>                                          |
| `VERCEL_ENV` values (`production`, `preview`, `development`)\*                                                                        | same page                                                                                                             |
| `vercel-build` script used instead of `build` when present\*; `buildCommand` in `vercel.json`\*                                       | <https://vercel.com/docs/project-configuration> and <https://vercel.com/docs/deployments/configure-a-build>           |
| Neon integration variables: `DATABASE_URL` pooled, `DATABASE_URL_UNPOOLED` direct                                                     | <https://neon.com/docs/guides/neon-managed-vercel-integration>                                                        |
| Preview deployments get a Neon branch named `preview/<git-branch>`, with its connection string injected for that deployment only      | <https://neon.com/docs/guides/vercel-previews-integration>                                                            |
| Default database name `neondb`\*, exact labels in both dashboards\*                                                                   | the dashboards themselves                                                                                             |
| Function duration limits with Fluid compute                                                                                           | <https://vercel.com/docs/functions/configuring-functions/duration> (checked October 2026, see `docs/architecture.md`) |

The code's behaviour that does **not** depend on those pages (derived auth URL, the bearer check,
the throttle, the reset guard, the build order) is covered by the unit and integration tests, and
the whole build ran locally against a fresh database.
