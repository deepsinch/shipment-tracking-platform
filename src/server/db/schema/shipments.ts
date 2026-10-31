import { sql } from "drizzle-orm";
import {
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { SERVICE_LEVELS } from "@/domain/service-level";
import { SHIPMENT_EVENT_TYPES } from "@/domain/shipment-event";
import { SHIPMENT_STATUSES } from "@/domain/shipment-status";

import { organization, user } from "./auth";

export const shipmentStatusEnum = pgEnum("shipment_status", SHIPMENT_STATUSES);
export const serviceLevelEnum = pgEnum("service_level", SERVICE_LEVELS);
export const shipmentEventTypeEnum = pgEnum("shipment_event_type", SHIPMENT_EVENT_TYPES);

/** All our own timestamps are timezone-aware and surface as JS Dates. */
const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const shipments = pgTable(
  "shipments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    trackingCode: text("tracking_code").notNull().unique(),
    status: shipmentStatusEnum("status").notNull().default("created"),
    /** The customer's own reference (order number, PO), free text. */
    reference: text("reference"),

    recipientName: text("recipient_name").notNull(),
    recipientEmail: text("recipient_email"),

    originAddressLine: text("origin_address_line").notNull(),
    originCity: text("origin_city").notNull(),
    originPostalCode: text("origin_postal_code"),
    /** ISO 3166-1 alpha-2. */
    originCountry: text("origin_country").notNull(),
    originLat: doublePrecision("origin_lat"),
    originLng: doublePrecision("origin_lng"),

    destinationAddressLine: text("destination_address_line").notNull(),
    destinationCity: text("destination_city").notNull(),
    destinationPostalCode: text("destination_postal_code"),
    /** ISO 3166-1 alpha-2. */
    destinationCountry: text("destination_country").notNull(),
    destinationLat: doublePrecision("destination_lat"),
    destinationLng: doublePrecision("destination_lng"),

    weightKg: numeric("weight_kg", { precision: 10, scale: 2, mode: "number" }).notNull(),
    serviceLevel: serviceLevelEnum("service_level").notNull().default("standard"),
    promisedDeliveryAt: timestamptz("promised_delivery_at"),
    assignedDriverId: text("assigned_driver_id").references(() => user.id, {
      onDelete: "set null",
    }),

    /** Optimistic concurrency token: bumped on every change, see docs/architecture.md. */
    version: integer("version").notNull().default(1),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Default dashboard listing: newest first within an organization.
    index("shipments_org_created_at_idx").on(table.organizationId, table.createdAt.desc()),
    // Status filter on the same listing.
    index("shipments_org_status_created_at_idx").on(
      table.organizationId,
      table.status,
      table.createdAt.desc(),
    ),
    // Driver's "my shipments" view (Phase 2) and the driver scope in services.
    index("shipments_assigned_driver_idx")
      .on(table.assignedDriverId)
      .where(sql`${table.assignedDriverId} is not null`),
  ],
);

/**
 * Append-only history. A trigger (migration 0001) rejects UPDATE and DELETE.
 * `occurred_at` is when it happened in the real world; `recorded_at` is when the server stored it.
 *
 * Every foreign key here is `restrict`: a cascading delete or `set null` would itself be an
 * UPDATE/DELETE of history and be rejected by the trigger anyway. So users, organizations and
 * shipments that have history cannot be hard-deleted; deactivate them instead.
 */
export const shipmentEvents = pgTable(
  "shipment_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "restrict" }),
    type: shipmentEventTypeEnum("type").notNull(),
    fromStatus: shipmentStatusEnum("from_status"),
    toStatus: shipmentStatusEnum("to_status"),
    occurredAt: timestamptz("occurred_at").notNull(),
    recordedAt: timestamptz("recorded_at").notNull().defaultNow(),
    /** Null for system-generated events (e.g. seed data). */
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "restrict" }),
    locationCity: text("location_city"),
    locationLat: doublePrecision("location_lat"),
    locationLng: doublePrecision("location_lng"),
    /** Shown on the public tracking page. */
    publicNote: text("public_note"),
    /** Visible to the organization only. */
    internalNote: text("internal_note"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    // Timeline for one shipment, in real-world order.
    index("shipment_events_shipment_occurred_at_idx").on(table.shipmentId, table.occurredAt),
    index("shipment_events_org_recorded_at_idx").on(table.organizationId, table.recordedAt),
  ],
);

export type Shipment = typeof shipments.$inferSelect;
export type NewShipment = typeof shipments.$inferInsert;
export type ShipmentEvent = typeof shipmentEvents.$inferSelect;
export type NewShipmentEvent = typeof shipmentEvents.$inferInsert;
