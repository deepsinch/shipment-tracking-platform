import "server-only";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema> & { $client: Pool };
/** The `tx` handle passed to `db.transaction(async (tx) => ...)`. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Either the root client or a transaction, for helpers that work inside or outside one. */
export type Executor = Database | Transaction;

// Cached on globalThis so development hot reloads reuse one pool instead of leaking a pool each.
const globalForDb = globalThis as typeof globalThis & { waybillDb?: Database };

/**
 * Returns the shared Drizzle client, creating the connection pool on first use.
 *
 * Creating it lazily (rather than at import time) means modules that import services can be
 * loaded without DATABASE_URL, e.g. during `next build` in CI. The pool itself only opens
 * connections when the first query runs.
 */
export function getDb(): Database {
  if (!globalForDb.waybillDb) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set. Copy .env.example to .env (see README).");
    }
    globalForDb.waybillDb = drizzle({ client: new Pool({ connectionString: url }), schema });
  }
  return globalForDb.waybillDb;
}

/** Closes the pool if one was created. For scripts and tests; the Next.js server keeps it open. */
export async function closeDb(): Promise<void> {
  const db = globalForDb.waybillDb;
  delete globalForDb.waybillDb;
  await db?.$client.end();
}
