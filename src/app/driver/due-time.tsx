import { ClockIcon, TriangleAlertIcon } from "lucide-react";

import { isOverdue } from "@/domain/driver-tasks";
import type { ShipmentStatus } from "@/domain/shipment-status";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The promised delivery time, flagged in red with words (not only colour) once an active shipment
 * is past it. `now` comes from the page, so a list renders against one clock.
 */
export function DueTime({
  shipment,
  now,
  label = "Due",
}: {
  shipment: { status: ShipmentStatus; promisedDeliveryAt: Date | null };
  now: Date;
  label?: string;
}) {
  const due = shipment.promisedDeliveryAt;
  if (!due) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <ClockIcon className="size-4" aria-hidden="true" />
        No delivery deadline
      </p>
    );
  }
  const overdue = isOverdue(shipment, now);
  const Icon = overdue ? TriangleAlertIcon : ClockIcon;
  return (
    <p
      className={cn("flex items-center gap-1.5 text-sm", overdue && "font-medium text-destructive")}
    >
      <Icon className={cn("size-4", !overdue && "text-muted-foreground")} aria-hidden="true" />
      <span>
        {overdue && "Overdue · "}
        {label} <time dateTime={due.toISOString()}>{formatDateTime(due)}</time>
      </span>
    </p>
  );
}
