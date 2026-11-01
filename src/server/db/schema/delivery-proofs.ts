import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import {
  RECIPIENT_NAME_MAX_LENGTH,
  SIGNATURE_MAX_BYTES,
  type Signature,
} from "@/domain/delivery-proof";

import { organization, user } from "./auth";
import { shipments } from "./shipments";

/**
 * Proof of delivery: who received the shipment, and optionally their drawn signature and a photo.
 * Written in the same transaction as the `delivered` status change, so a proof exists only for a
 * delivery that committed (and a delivery by a driver never exists without one).
 *
 * Append-only like the history it belongs to: a trigger (migration 0010) rejects UPDATE, DELETE
 * and TRUNCATE. A proof is evidence; correcting it would mean someone rewrote what the recipient
 * agreed to. There is no retention job yet: when a retention or erasure policy exists it needs a
 * deliberate migration (decision 70), not an exception hidden in application code.
 *
 * No proof row means "delivered without proof" (marked by the office, or before this feature).
 * One proof per shipment: `delivered` is terminal, so there is exactly one delivered event.
 */
export const deliveryProofs = pgTable(
  "delivery_proofs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    /** FK is composite with organization_id, see the table constraints below. */
    shipmentId: uuid("shipment_id").notNull(),
    /**
     * The `status_changed` event that moved the shipment to delivered, written in the same
     * transaction. Deliberately not a foreign key: a table that other tables reference cannot be
     * truncated at all (Postgres refuses with 0A000 before any trigger runs), which would hide
     * `shipment_events`' own TRUNCATE trigger from its test. The link is made by the one code path
     * that writes both rows, and the unique constraint below keeps it one proof per event.
     */
    eventId: uuid("event_id").notNull(),
    /** The recipient's printed name: the proof every delivery with proof has. */
    recipientName: text("recipient_name").notNull(),
    /** Vector strokes (`Signature`), or null when the recipient did not sign. */
    signature: jsonb("signature").$type<Signature>(),
    /**
     * Where the photo is in storage (never shown to a browser), or null. `demo/sample` marks the
     * demo's placeholder: nothing is stored for it.
     */
    photoKey: text("photo_key"),
    capturedBy: text("captured_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    capturedAt: timestamp("captured_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "delivery_proofs_shipment_org_fk",
      columns: [table.shipmentId, table.organizationId],
      foreignColumns: [shipments.id, shipments.organizationId],
    }).onDelete("restrict"),
    unique("delivery_proofs_shipment_id_unique").on(table.shipmentId),
    unique("delivery_proofs_event_id_unique").on(table.eventId),
    // Last line of defence behind Zod validation.
    check(
      "delivery_proofs_recipient_name_valid",
      sql`btrim(${table.recipientName}) <> '' AND char_length(${table.recipientName}) <= ${sql.raw(String(RECIPIENT_NAME_MAX_LENGTH))}`,
    ),
    check(
      "delivery_proofs_signature_valid",
      sql`${table.signature} IS NULL OR (jsonb_typeof(${table.signature}) = 'object' AND octet_length(${table.signature}::text) <= ${sql.raw(String(SIGNATURE_MAX_BYTES))})`,
    ),
    check(
      "delivery_proofs_photo_key_valid",
      sql`${table.photoKey} IS NULL OR (${table.photoKey} <> '' AND char_length(${table.photoKey}) <= 300)`,
    ),
  ],
);

export type DeliveryProof = typeof deliveryProofs.$inferSelect;
