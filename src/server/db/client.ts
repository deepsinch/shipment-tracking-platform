import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env (see README).");
  }
  return url;
}

// Reuse one pool across hot reloads in development instead of leaking a pool per reload.
const globalForDb = globalThis as typeof globalThis & { waybillPool?: Pool };

const pool = globalForDb.waybillPool ?? new Pool({ connectionString: databaseUrl() });
if (process.env.NODE_ENV !== "production") {
  globalForDb.waybillPool = pool;
}

export const db = drizzle({ client: pool, schema });

export type Database = typeof db;
/** The `tx` handle passed to `db.transaction(async (tx) => ...)`. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Either the root client or a transaction, for helpers that work inside or outside one. */
export type Executor = Database | Transaction;

/** Closes the pool. For scripts and tests; the Next.js server keeps it open. */
export async function closeDb(): Promise<void> {
  await pool.end();
  delete globalForDb.waybillPool;
}
