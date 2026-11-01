import { sql } from "drizzle-orm";
import {
  bigserial,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
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

/** CHECK expressions for optional coordinates (null allowed, otherwise a valid range). */
const latitudeInRange = (column: AnyPgColumn) =>
  sql`${column} IS NULL OR ${column} BETWEEN -90 AND 90`;
const longitudeInRange = (column: AnyPgColumn) =>
  sql`${column} IS NULL OR ${column} BETWEEN -180 AND 180`;

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
    // Target of the composite FK from shipment_events, which pins each event to its shipment's org.
    unique("shipments_id_organization_id_unique").on(table.id, table.organizationId),
    // Last line of defence behind Zod validation.
    check("shipments_weight_kg_positive", sql`${table.weightKg} > 0`),
    check("shipments_version_positive", sql`${table.version} >= 1`),
    check("shipments_origin_lat_range", latitudeInRange(table.originLat)),
    check("shipments_origin_lng_range", longitudeInRange(table.originLng)),
    check("shipments_destination_lat_range", latitudeInRange(table.destinationLat)),
    check("shipments_destination_lng_range", longitudeInRange(table.destinationLng)),
    check("shipments_origin_country_iso2", sql`${table.originCountry} ~ '^[A-Z]{2}$'`),
    check("shipments_destination_country_iso2", sql`${table.destinationCountry} ~ '^[A-Z]{2}$'`),
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
    /** FK is composite with organization_id, see the table constraints below. */
    shipmentId: uuid("shipment_id").notNull(),
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
    /** Shown on the public tracking page and in the customer's status email. */
    publicNote: text("public_note"),
    /** Visible to the organization only. */
    internalNote: text("internal_note"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    // Timeline for one shipment, in real-world order.
    index("shipment_events_shipment_occurred_at_idx").on(table.shipmentId, table.occurredAt),
    index("shipment_events_org_recorded_at_idx").on(table.organizationId, table.recordedAt),
    // An event must belong to the same organization as its shipment.
    foreignKey({
      name: "shipment_events_shipment_org_fk",
      columns: [table.shipmentId, table.organizationId],
      foreignColumns: [shipments.id, shipments.organizationId],
    }).onDelete("restrict"),
    check("shipment_events_location_lat_range", latitudeInRange(table.locationLat)),
    check("shipment_events_location_lng_range", longitudeInRange(table.locationLng)),
    check(
      "shipment_events_status_change_has_target",
      sql`${table.type} <> 'status_changed' OR ${table.toStatus} IS NOT NULL`,
    ),
  ],
);

export type Shipment = typeof shipments.$inferSelect;
export type NewShipment = typeof shipments.$inferInsert;
export type ShipmentEvent = typeof shipmentEvents.$inferSelect;
export type NewShipmentEvent = typeof shipmentEvents.$inferInsert;

/**
 * Location telemetry from the driver app: one row per accepted ping. Not history in the
 * `shipment_events` sense (see docs/architecture.md, "Location telemetry is not history"):
 * pings are throttled, never shown publicly and pruned after 30 days, so DELETE is allowed. A
 * trigger (migration 0005) still rejects UPDATE: a recorded fix is never corrected.
 *
 * `recorded_at` is the device's time of the fix; `received_at` is when the server stored it.
 */
export const locationPings = pgTable(
  "location_pings",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    /** FK is composite with organization_id, see the table constraints below. */
    shipmentId: uuid("shipment_id").notNull(),
    driverId: text("driver_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    /** Radius of the device's 95% confidence circle, in metres. */
    accuracyM: doublePrecision("accuracy_m").notNull(),
    recordedAt: timestamptz("recorded_at").notNull(),
    receivedAt: timestamptz("received_at").notNull().defaultNow(),
  },
  (table) => [
    // A shipment's track, newest first.
    index("location_pings_shipment_recorded_at_idx").on(table.shipmentId, table.recordedAt.desc()),
    foreignKey({
      name: "location_pings_shipment_org_fk",
      columns: [table.shipmentId, table.organizationId],
      foreignColumns: [shipments.id, shipments.organizationId],
    }).onDelete("restrict"),
    check("location_pings_lat_range", sql`${table.lat} BETWEEN -90 AND 90`),
    check("location_pings_lng_range", sql`${table.lng} BETWEEN -180 AND 180`),
    check("location_pings_accuracy_non_negative", sql`${table.accuracyM} >= 0`),
  ],
);

/**
 * The latest known position of each shipment, upserted in the same transaction as each accepted
 * ping. Maps read one row per shipment from here instead of searching the pings. It lives apart
 * from `shipments` so telemetry never touches `shipments.version` (status concurrency).
 *
 * `updated_at` is the server time of the last accepted ping, and the single source of truth for
 * the 10-second throttle (see `recordLocationPing`). It moves with every accepted ping, even a
 * late one whose older `recorded_at` leaves the position where it is.
 */
export const shipmentPositions = pgTable(
  "shipment_positions",
  {
    shipmentId: uuid("shipment_id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    accuracyM: doublePrecision("accuracy_m").notNull(),
    /** Device time of the fix this position comes from. */
    recordedAt: timestamptz("recorded_at").notNull(),
    /** The driver who reported this position. */
    driverId: text("driver_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "shipment_positions_shipment_org_fk",
      columns: [table.shipmentId, table.organizationId],
      foreignColumns: [shipments.id, shipments.organizationId],
    }).onDelete("restrict"),
    check("shipment_positions_lat_range", sql`${table.lat} BETWEEN -90 AND 90`),
    check("shipment_positions_lng_range", sql`${table.lng} BETWEEN -180 AND 180`),
    check("shipment_positions_accuracy_non_negative", sql`${table.accuracyM} >= 0`),
  ],
);

export type LocationPing = typeof locationPings.$inferSelect;
export type ShipmentPosition = typeof shipmentPositions.$inferSelect;
