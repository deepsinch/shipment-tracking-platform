import { Badge } from "@/components/ui/badge";
import { shipmentStatusLabel, type ShipmentStatus } from "@/domain/shipment-status";
import { statusTone, type StatusTone } from "@/lib/status-tone";
import { cn } from "@/lib/utils";

/**
 * Badge colour per tone (see `statusTone`): neutral before pickup, sky while moving, indigo out
 * for delivery, green done, red problem, struck-through grey when cancelled. Map markers use the
 * same hues (`TONE_MARKER_COLORS`).
 */
const TONE_STYLES: Record<StatusTone, string> = {
  waiting: "bg-secondary text-secondary-foreground",
  moving: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  arriving: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300",
  done: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  problem: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  off: "border-border bg-transparent text-muted-foreground line-through",
};

export function StatusBadge({ status, className }: { status: ShipmentStatus; className?: string }) {
  return (
    <Badge variant="secondary" className={cn(TONE_STYLES[statusTone(status)], className)}>
      {shipmentStatusLabel(status)}
    </Badge>
  );
}
