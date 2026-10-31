/**
 * What the browser receives on the realtime stream (`/api/realtime`), one JSON object per SSE
 * `data:` line. It is a projection of the server's messages: no organization or user ids, only
 * what a page needs to decide whether to re-read its data.
 *
 * - `resync`: the stream is (re)established, and anything before it may have been missed. Pages
 *   re-fetch their current state. Sent first on every connection and after the server's own
 *   database listener reconnects.
 * - `shipment_changed`: re-read anything showing this shipment.
 * - `position`: the shipment's latest known position moved.
 */
export type RealtimeClientEvent =
  | { kind: "resync" }
  | {
      kind: "shipment_changed";
      shipmentId: string;
      reason: "created" | "status" | "assignment";
    }
  | { kind: "position"; shipmentId: string; lat: number; lng: number; recordedAt: string };

export type ShipmentChangedEvent = Extract<RealtimeClientEvent, { kind: "shipment_changed" }>;
export type PositionEvent = Extract<RealtimeClientEvent, { kind: "position" }>;

const CHANGE_REASONS: readonly string[] = ["created", "status", "assignment"];

/**
 * Parses one SSE `data` payload. The stream comes from our own server, so this is a light shape
 * check (no Zod in the client bundle): anything unexpected, such as a newer server's event kind
 * during a deploy, is ignored rather than crashing the page.
 */
export function parseRealtimeClientEvent(data: string): RealtimeClientEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || !("kind" in value)) return null;
  const event = value as Record<string, unknown>;

  switch (event.kind) {
    case "resync":
      return { kind: "resync" };
    case "shipment_changed":
      if (typeof event.shipmentId !== "string") return null;
      if (typeof event.reason !== "string" || !CHANGE_REASONS.includes(event.reason)) return null;
      return {
        kind: "shipment_changed",
        shipmentId: event.shipmentId,
        reason: event.reason as ShipmentChangedEvent["reason"],
      };
    case "position":
      if (
        typeof event.shipmentId !== "string" ||
        typeof event.lat !== "number" ||
        typeof event.lng !== "number" ||
        typeof event.recordedAt !== "string" ||
        Number.isNaN(Date.parse(event.recordedAt))
      ) {
        return null;
      }
      return {
        kind: "position",
        shipmentId: event.shipmentId,
        lat: event.lat,
        lng: event.lng,
        recordedAt: event.recordedAt,
      };
    default:
      return null;
  }
}
