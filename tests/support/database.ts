import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/**
 * Database preparation shared by the integration tests (`*_test`) and the end-to-end tests
 * (`*_e2e`). Both wipe their database, so both refuse any database without a throwaway suffix.
 */

const MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, "../../src/server/db/migrations");

export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

export function assertThrowawayDatabase(url: string, suffix: "_test" | "_e2e"): void {
  const name = databaseName(url);
  if (!name.endsWith(suffix)) {
    throw new Error(`Refusing to reset "${name}": the database name must end in ${suffix}.`);
  }
}

/** Creates the database if it does not exist yet, connecting to the `postgres` maintenance DB. */
export async function ensureDatabaseExists(url: string): Promise<void> {
  const maintenanceUrl = new URL(url);
  maintenanceUrl.pathname = "/postgres";
  const pool = new Pool({ connectionString: maintenanceUrl.toString() });
  try {
    const name = databaseName(url);
    const { rowCount } = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (!rowCount) {
      // Identifiers cannot be bound as parameters; quote it (the name was checked by the caller).
      await pool.query(`CREATE DATABASE "${name.replaceAll('"', '""')}"`);
    }
  } finally {
    await pool.end();
  }
}

/**
 * Drops everything in the database and applies every committed migration, so tests run against
 * exactly what `pnpm db:migrate` produces.
 */
export async function resetDatabase(url: string): Promise<void> {
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await migrate(drizzle({ client: pool }), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}
