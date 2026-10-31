import type { Metadata } from "next";

import { FleetMap } from "@/components/map/fleet-map";
import { ShipmentsViewNav } from "@/components/shipments-view-nav";
import type { FleetShipment } from "@/lib/live-positions";
import { requireAuthContextOn } from "@/server/auth/session";
import {
  getShipmentPositions,
  type ShipmentPositionSnapshot,
} from "@/server/services/get-shipment-positions";

export const metadata: Metadata = { title: "Live map" };

/** Only what the map shows crosses to the browser (no driver id or accuracy). */
const toFleetShipment = (position: ShipmentPositionSnapshot): FleetShipment => ({
  shipmentId: position.shipmentId,
  trackingCode: position.trackingCode,
  status: position.status,
  destinationCity: position.destinationCity,
  destinationCountry: position.destinationCountry,
  lat: position.lat,
  lng: position.lng,
  recordedAt: position.recordedAt.toISOString(),
});

/**
 * The live map of every unfinished shipment with a known position. A page of its own, next to the
 * list (`ShipmentsViewNav`): a shareable URL, and the list stays free of MapLibre's code.
 */
export default async function MapPage() {
  const ctx = await requireAuthContextOn("/dashboard");
  const result = await getShipmentPositions(ctx);
  // No input, so nothing to reject; a failure here is a bug.
  if (!result.ok) throw new Error("Could not load shipment positions");

  return (
    <main className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Live map</h1>
          <p className="text-sm text-muted-foreground">
            Where your shipments were last seen, updated as drivers report.
          </p>
        </div>
        <ShipmentsViewNav current="map" />
      </div>
      <FleetMap snapshot={result.positions.map(toFleetShipment)} />
    </main>
  );
}
