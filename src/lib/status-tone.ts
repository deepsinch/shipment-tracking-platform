import type { ShipmentStatus } from "@/domain/shipment-status";

/**
 * Statuses grouped by what a dispatcher should read from their colour: not yet moving, moving,
 * nearly there, done, needs attention, called off. The status badge and the map markers both
 * colour by tone, so a shipment looks the same in the list, on the map and on its detail page.
 */
export type StatusTone = "waiting" | "moving" | "arriving" | "done" | "problem" | "off";

const STATUS_TONES: Readonly<Record<ShipmentStatus, StatusTone>> = {
  created: "waiting",
  picked_up: "moving",
  in_transit: "moving",
  out_for_delivery: "arriving",
  delivered: "done",
  exception: "problem",
  cancelled: "off",
};

export function statusTone(status: ShipmentStatus): StatusTone {
  return STATUS_TONES[status];
}

/**
 * Marker fill per tone, as hex because map markers and route lines are drawn outside Tailwind's
 * classes: the 600 shade of the badge's Tailwind hue (slate, sky, indigo, emerald, red; zinc 500
 * for "off"), dark enough for a white icon and outline to stand out (at least 3:1, the contrast
 * WCAG asks of graphics).
 */
export const TONE_MARKER_COLORS: Readonly<Record<StatusTone, string>> = {
  waiting: "#475569",
  moving: "#0284c7",
  arriving: "#4f46e5",
  done: "#059669",
  problem: "#dc2626",
  off: "#71717a",
};

export function statusMarkerColor(status: ShipmentStatus): string {
  return TONE_MARKER_COLORS[statusTone(status)];
}
