import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { shipmentStatusLabel, type ShipmentStatus } from "@/domain/shipment-status";

/** Colour groups: neutral before pickup, blue while moving, green done, red problem, grey off. */
const STATUS_STYLES: Record<ShipmentStatus, string> = {
  created: "bg-secondary text-secondary-foreground",
  picked_up: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  in_transit: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  out_for_delivery: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300",
  delivered: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  exception: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  cancelled: "border-border bg-transparent text-muted-foreground line-through",
};

export function StatusBadge({ status, className }: { status: ShipmentStatus; className?: string }) {
  return (
    <Badge variant="secondary" className={cn(STATUS_STYLES[status], className)}>
      {shipmentStatusLabel(status)}
    </Badge>
  );
}
