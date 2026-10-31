import { z } from "zod";

/**
 * Realtime messages are invalidation signals, not data: "shipment X changed" or "shipment X is now
 * here". Clients re-read what they show (see docs/architecture.md, "Realtime"). They travel from
 * a service's transaction through Postgres `pg_notify` to every server instance's listener, so
 * the wire format is validated on both ends: before publishing and again on receipt.
 */

/** The one Postgres channel all realtime messages share. */
export const REALTIME_CHANNEL = "waybill_events";

/** Postgres rejects a NOTIFY payload of 8000 bytes or more. Ours stay around 250 bytes. */
export const MAX_PAYLOAD_BYTES = 8000;

/** Better Auth ids (users, organizations) are opaque strings, not uuids. */
const opaqueId = z.string().min(1).max(100);

export const SHIPMENT_CHANGE_REASONS = ["created", "status", "assignment"] as const;
export type ShipmentChangeReason = (typeof SHIPMENT_CHANGE_REASONS)[number];

const shipmentChangedSchema = z.object({
  kind: z.literal("shipment_changed"),
  organizationId: opaqueId,
  shipmentId: z.uuid(),
  /** The driver assigned after the change, or null. */
  assignedDriverId: opaqueId.nullable(),
  /**
   * The driver who lost the shipment in this change (a reassignment or unassignment), so their
   * app can drop it too. Null for every other change.
   */
  previousDriverId: opaqueId.nullable(),
  reason: z.enum(SHIPMENT_CHANGE_REASONS),
});

const positionSchema = z.object({
  kind: z.literal("position"),
  organizationId: opaqueId,
  shipmentId: z.uuid(),
  /** The driver who reported the position, who is the assigned driver (pings require it). */
  assignedDriverId: opaqueId.nullable(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** Device time of the fix, ISO 8601. */
  recordedAt: z.iso.datetime(),
});

export const realtimeMessageSchema = z.discriminatedUnion("kind", [
  shipmentChangedSchema,
  positionSchema,
]);

export type RealtimeMessage = z.infer<typeof realtimeMessageSchema>;
export type ShipmentChangedMessage = Extract<RealtimeMessage, { kind: "shipment_changed" }>;
export type PositionMessage = Extract<RealtimeMessage, { kind: "position" }>;

/**
 * Validates a message and serializes it for `pg_notify`. Throws on an invalid or oversized
 * message: both are programming errors, and failing the write is better than announcing garbage.
 */
export function encodeRealtimeMessage(message: RealtimeMessage): string {
  const payload = JSON.stringify(realtimeMessageSchema.parse(message));
  const bytes = Buffer.byteLength(payload, "utf8");
  if (bytes >= MAX_PAYLOAD_BYTES) {
    throw new Error(`Realtime payload is ${bytes} bytes; Postgres allows less than 8000`);
  }
  return payload;
}

/** Parses a received payload. Null for anything that is not a valid message. */
export function decodeRealtimeMessage(payload: string): RealtimeMessage | null {
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return null;
  }
  const parsed = realtimeMessageSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
