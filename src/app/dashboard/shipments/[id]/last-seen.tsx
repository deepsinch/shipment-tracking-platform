"use client";

import { useLivePosition, type LivePosition } from "@/components/realtime/use-live-position";
import { formatDateTime } from "@/lib/format";

/** "51.2194, 4.4025": about 10 m of precision, plenty for "where is the truck". */
const formatCoordinates = ({ lat, lng }: LivePosition) => `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

/**
 * Where the shipment's driver last reported it, kept current by realtime position events. Not a
 * live region: positions arrive every few seconds and announcing each would drown everything else.
 */
export function LastSeen({
  shipmentId,
  initial,
}: {
  shipmentId: string;
  initial: LivePosition | null;
}) {
  const position = useLivePosition(shipmentId, initial);

  return (
    <span data-testid="last-seen">
      {position ? (
        <>
          {formatDateTime(new Date(position.recordedAt))}
          <span className="block text-muted-foreground">near {formatCoordinates(position)}</span>
        </>
      ) : (
        <span className="text-muted-foreground">No location shared yet</span>
      )}
    </span>
  );
}
