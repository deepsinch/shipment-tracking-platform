/**
 * `pnpm db:seed` — loads the "Demo Freight Co" demo data into DATABASE_URL.
 *
 * - Default: seeds once; a re-run is a no-op (history cannot be deleted, so nothing is refreshed).
 * - `--reset`: wipes and re-migrates the database first, so dates are fresh again. Only the local
 *   dev database `waybill` may be reset this way.
 *
 * Runs with `tsx --conditions=react-server` so the `server-only` imports in services resolve.
 */
import { config as loadEnv } from "dotenv";

import { closeDb } from "@/server/db/client";
import { assertDatabaseName, resetDatabase } from "@/server/db/maintenance";
import { DEMO_PASSWORD, DEMO_USERS, seedDemo } from "@/server/seed/demo-seed";

loadEnv({ quiet: true });

const DEV_DATABASE = "waybill";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env (see README).");

  if (process.argv.includes("--reset")) {
    assertDatabaseName(
      url,
      (name) => name === DEV_DATABASE,
      `only the local dev database "${DEV_DATABASE}" can be reset by the seed`,
    );
    await resetDatabase(url);
    console.log(`Reset and migrated "${DEV_DATABASE}".`);
  }

  const result = await seedDemo();
  if (result.status === "skipped") {
    console.log(`Demo data already present (${result.reason}). Use --reset for fresh data.`);
  } else {
    console.log(`Seeded ${result.shipmentCount} shipments for Demo Freight Co.`);
  }
  console.log(`\nSign in at /sign-in with password "${DEMO_PASSWORD}":`);
  for (const account of DEMO_USERS) console.log(`  ${account.role.padEnd(10)} ${account.email}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
