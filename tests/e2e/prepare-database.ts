/**
 * First step of the e2e web server command (see playwright.config.ts): creates the dedicated
 * e2e database if needed, then wipes and migrates it. It runs before `next build && next start`,
 * so the app never sees a half-migrated database.
 */
import {
  assertDatabaseName,
  ensureDatabaseExists,
  resetDatabase,
} from "../../src/server/db/maintenance";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (playwright.config.ts sets it).");
assertDatabaseName(url, (name) => name.endsWith("_e2e"), "the database name must end in _e2e");

try {
  await ensureDatabaseExists(url);
  await resetDatabase(url);
  console.log("e2e database ready");
} catch (error) {
  console.error(
    "Could not prepare the e2e database. Is Postgres running (service postgresql start), and may " +
      "the role create databases (CREATEDB, see .env.example)?",
  );
  throw error;
}
