"use client";

import { useLivePosition, type LivePosition } from "@/components/realtime/use-live-position";
import { formatDateTime } from "@/lib/format";
import { formatCoordinates } from "@/lib/geo";

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
