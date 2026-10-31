/**
 * e2e check: prints the stored latest position of a shipment as JSON (or `null`). There is no map
 * yet (Phase 2, checkpoint 4), so this is how the location sharing spec confirms what the server
 * stored. Read-only.
 *
 * Usage (see `readPosition` in helpers.ts):
 *   tsx --conditions=react-server tests/e2e/read-position.ts <tracking code>
 */
import { eq } from "drizzle-orm";

import { closeDb, getDb } from "@/server/db/client";
import { assertDatabaseName } from "@/server/db/maintenance";
import { shipmentPositions, shipments } from "@/server/db/schema";

const [trackingCode] = process.argv.slice(2);
if (!trackingCode) throw new Error("Usage: read-position.ts <tracking code>");
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");
assertDatabaseName(url, (db) => db.endsWith("_e2e"), "the database name must end in _e2e");

try {
  const [position] = await getDb()
    .select({
      lat: shipmentPositions.lat,
      lng: shipmentPositions.lng,
      accuracyM: shipmentPositions.accuracyM,
    })
    .from(shipmentPositions)
    .innerJoin(shipments, eq(shipments.id, shipmentPositions.shipmentId))
    .where(eq(shipments.trackingCode, trackingCode));
  process.stdout.write(JSON.stringify(position ?? null));
} finally {
  await closeDb();
}
