import "server-only";

import { DEMO_ORGANIZATION_NAME } from "@/domain/demo";
import { assertDatabaseName, databaseName, resetDatabase } from "@/server/db/maintenance";
import { env } from "@/server/env";
import { seedDemo } from "@/server/seed/demo-seed";

export type ResetDemoResult =
  | { ok: true; shipmentCount: number }
  | { ok: false; reason: "demo_disabled" }
  /** The safety checks said no; `message` names the database and the setting to change. */
  | { ok: false; reason: "refused"; message: string };

export type ResetDemoOptions = {
  /** Direct (session) connection: the wipe and the migrations run on it. */
  directUrl: string;
  /** The app's own (pooled) connection, which the seed uses; must be the same database. */
  poolUrl: string;
  /** Names of the databases that may be wiped (`DEMO_RESET_DATABASES`). */
  allowedDatabases: readonly string[];
};

/**
 * The reset's two safety checks, before anything is dropped. The database must be named in the
 * allow-list (so a wipe can only hit a database the owner named on purpose, whatever the host
 * calls it), and the pooled and direct URLs must point at the same database (so the seed fills
 * what the wipe emptied).
 */
export function checkResetAllowed({
  directUrl,
  poolUrl,
  allowedDatabases,
}: ResetDemoOptions): { ok: true } | { ok: false; message: string } {
  try {
    assertDatabaseName(
      directUrl,
      (name) => allowedDatabases.includes(name),
      `it is not listed in DEMO_RESET_DATABASES (${allowedDatabases.join(", ") || "empty"})`,
    );
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
  if (databaseName(directUrl) !== databaseName(poolUrl)) {
    return {
      ok: false,
      message:
        `Refusing to reset: DATABASE_URL points at "${databaseName(poolUrl)}" but the direct ` +
        `connection at "${databaseName(directUrl)}".`,
    };
  }
  return { ok: true };
}

/**
 * Recreates the demo database from scratch: drops everything, applies every migration and seeds
 * Demo Freight Co again. Wiping rather than deleting rows, because history cannot be deleted by
 * design (append-only events, restrict foreign keys). Every user is signed out by it, since
 * sessions live in the database too.
 *
 * Runs only in demo mode and only for a database named in `DEMO_RESET_DATABASES`. By default the
 * options come from the environment; tests pass their own.
 */
export async function resetDemo(options?: ResetDemoOptions): Promise<ResetDemoResult> {
  if (!env.demo.enabled) return { ok: false, reason: "demo_disabled" };
  const resolved = options ?? {
    directUrl: env.database.directUrl,
    poolUrl: env.database.url,
    allowedDatabases: env.demo.resetDatabases,
  };

  const check = checkResetAllowed(resolved);
  if (!check.ok) return { ok: false, reason: "refused", message: check.message };

  await resetDatabase(resolved.directUrl);
  const seeded = await seedDemo();
  if (seeded.status !== "seeded") {
    throw new Error(
      `${DEMO_ORGANIZATION_NAME} was not re-seeded after the reset: ${seeded.reason}`,
    );
  }
  return { ok: true, shipmentCount: seeded.shipmentCount };
}
