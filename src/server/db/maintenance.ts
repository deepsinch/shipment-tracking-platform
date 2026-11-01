import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";

/**
 * Database maintenance: test setups, the deploy build's migration step, the demo seed's reset and
 * the nightly demo reset (the only code in the running app that imports this). Callers that wipe a
 * database must first check its name with `assertDatabaseName`; only wipes are guarded, so
 * migrating a database never depends on what it is called.
 */

/**
 * Relative to the working directory (the project root for `next start`, Vercel functions, tsx
 * scripts and Vitest), not to this file: a bundler moves the file, and the SQL files are not part
 * of any bundle. `next.config.ts` makes the demo reset route's trace include the folder.
 */
export const MIGRATIONS_FOLDER = path.resolve(process.cwd(), "src/server/db/migrations");

/** Arbitrary constant: every process that migrates this database takes the same advisory lock. */
const MIGRATION_LOCK_KEY = 7_283_410_652;

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
  if (!allowed(name)) throw new Error(`Refusing to use "${name}": ${rule}.`);
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
 * Applies every committed migration that has not run yet, like `pnpm db:migrate`, but callable
 * from a deploy. `url` must be a direct (session) connection: the advisory lock below is held for
 * the whole run, which a transaction-mode pooler cannot do. The lock makes two builds that deploy
 * at once (production and a preview that share a database, or a retried build) take turns instead
 * of racing each other's DDL; the second finds nothing left to apply.
 */
export async function migrateDatabase(url: string): Promise<void> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    try {
      await migrate(drizzle({ client }), { migrationsFolder: MIGRATIONS_FOLDER });
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    }
  } finally {
    await client.end();
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
  } finally {
    await pool.end();
  }
  await migrateDatabase(url);
}
