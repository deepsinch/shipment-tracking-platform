import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/**
 * Database maintenance for tooling only (test setups, the demo seed's reset), never imported by
 * the app. Callers that wipe a database must first check its name with `assertDatabaseName`.
 */

const MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, "migrations");

export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

/** Throws unless the database name passes `allowed`, described by `rule` in the message. */
export function assertDatabaseName(
  url: string,
  allowed: (name: string) => boolean,
  rule: string,
): void {
  const name = databaseName(url);
  if (!allowed(name)) throw new Error(`Refusing to reset "${name}": ${rule}.`);
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
