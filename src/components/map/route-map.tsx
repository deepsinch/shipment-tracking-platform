"use client";

import dynamic from "next/dynamic";

import { useLivePosition, type LivePosition } from "@/components/realtime/use-live-position";

import { MapFrame, MapLoading } from "./map-frame";
import type { RouteMapCanvasProps } from "./route-map-canvas";

// Browser-only and large: its own chunk, shared with the dashboard map, loaded after the page.
const RouteMapCanvas = dynamic(() => import("./route-map-canvas"), {
  ssr: false,
  loading: MapLoading,
});

/**
 * The shipment's route and latest position on a small map. Supplementary: the page states the
 * addresses and the "Last seen" line as text. `initialPosition` is undefined when the position is
 * not shown at all (a finished shipment), null when nothing has been shared yet.
 */
export function RouteMap({
  initialPosition,
  ...props
}: Omit<RouteMapCanvasProps, "position"> & { initialPosition: LivePosition | null | undefined }) {
  const live = useLivePosition(props.shipment.shipmentId, initialPosition ?? null);
  const position = initialPosition === undefined ? null : live;

  return (
    <MapFrame className="h-56 sm:h-72">
      <RouteMapCanvas {...props} position={position} />
    </MapFrame>
  );
}
