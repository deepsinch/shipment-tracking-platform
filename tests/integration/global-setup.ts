import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { testDatabaseUrl } from "./test-database";

/**
 * Runs once before the integration project: wipes the test database and applies every committed
 * migration, so tests always run against exactly what `pnpm db:migrate` would produce.
 */
export default async function setup(): Promise<void> {
  const pool = new Pool({ connectionString: testDatabaseUrl() });
  try {
    await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: path.resolve(import.meta.dirname, "../../src/server/db/migrations"),
    });
  } catch (error) {
    throw new Error(
      "Could not prepare the test database. Is Postgres running (service postgresql start)?",
      { cause: error },
    );
  } finally {
    await pool.end();
  }
}
