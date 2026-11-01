import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import {
  DELIVERY_STATUSES,
  DISABLED_REASONS,
  WEBHOOK_EVENT_TYPES,
  type DeliveryStatus,
} from "@/domain/webhooks";

import { organization, user } from "./auth";

const literalArray = (values: readonly string[]) =>
  `ARRAY[${values.map((value) => `'${value}'`).join(", ")}]::text[]`;
const literalList = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/**
 * Where an organization wants shipment events sent (docs/architecture.md, "Webhooks without a
 * long-running worker"). Endpoints are disabled, never deleted: deliveries are history.
 *
 * `secret` is stored in clear because signing needs the key itself (a hash could not sign). See
 * decision 58 for why that is acceptable here and what the next step would be. It is never
 * returned by a list or read: only creation and rotation show it, once.
 */
export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    eventTypes: text("event_types").array().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /** Why it is off: an admin did it, or too many deliveries died in a row. Null while enabled. */
    disabledReason: text("disabled_reason"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("webhook_endpoints_id_organization_id_unique").on(table.id, table.organizationId),
    index("webhook_endpoints_org_created_at_idx").on(table.organizationId, table.createdAt),
    check("webhook_endpoints_url_length", sql`length(${table.url}) BETWEEN 1 AND 2000`),
    check("webhook_endpoints_event_types_not_empty", sql`cardinality(${table.eventTypes}) >= 1`),
    // Literals, not parameters: a CHECK cannot take bind parameters (see api_keys).
    check(
      "webhook_endpoints_event_types_known",
      sql`${table.eventTypes} <@ ${sql.raw(literalArray(WEBHOOK_EVENT_TYPES))}`,
    ),
    check(
      "webhook_endpoints_disabled_reason_matches",
      sql`(${table.enabled} AND ${table.disabledReason} IS NULL) OR (NOT ${table.enabled} AND ${table.disabledReason} IS NOT NULL AND ${table.disabledReason} IN (${sql.raw(literalList(DISABLED_REASONS))}))`,
    ),
  ],
);

export type WebhookEndpointRow = typeof webhookEndpoints.$inferSelect;

/**
 * The outbox and the delivery log in one table. A row is inserted in the transaction of the
 * change it reports (so it exists only if the change committed), then attempted until it
 * succeeds or runs out of attempts. The payload is stored as sent, so a retry or a resend is
 * byte-for-byte the same event.
 */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id").notNull(),
    endpointId: uuid("endpoint_id").notNull(),
    /** Shared by every delivery of one event (all endpoints, resends): receivers deduplicate on it. */
    eventId: uuid("event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").$type<DeliveryStatus>().notNull().default("pending"),
    /** Attempts started, including one still in flight or lost to a crash. */
    attempts: integer("attempts").notNull().default(0),
    /** When a drain may pick it up; null once it is succeeded or dead. A claim pushes it out (lease). */
    nextAttemptAt: timestamptz("next_attempt_at"),
    lastAttemptAt: timestamptz("last_attempt_at"),
    lastStatusCode: integer("last_status_code"),
    /** Short, truncated description of the last failure. Never a response body. */
    lastError: text("last_error"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "webhook_deliveries_endpoint_org_fk",
      columns: [table.endpointId, table.organizationId],
      foreignColumns: [webhookEndpoints.id, webhookEndpoints.organizationId],
    }).onDelete("restrict"),
    // The due-deliveries query: only open rows are indexed, ordered by when they are due.
    index("webhook_deliveries_due_idx")
      .on(table.nextAttemptAt, table.id)
      .where(sql`${table.status} IN ('pending', 'failed')`),
    // The delivery log of one endpoint, newest first.
    index("webhook_deliveries_endpoint_created_at_idx").on(table.endpointId, table.createdAt),
    check(
      "webhook_deliveries_status_known",
      sql`${table.status} IN (${sql.raw(literalList(DELIVERY_STATUSES))})`,
    ),
    check(
      "webhook_deliveries_event_type_known",
      sql`${table.eventType} IN (${sql.raw(literalList(WEBHOOK_EVENT_TYPES))})`,
    ),
    check("webhook_deliveries_attempts_not_negative", sql`${table.attempts} >= 0`),
    // Open rows are due at some time; finished rows are not due at all.
    check(
      "webhook_deliveries_next_attempt_matches_status",
      sql`(${table.status} IN ('pending', 'failed')) = (${table.nextAttemptAt} IS NOT NULL)`,
    ),
  ],
);

export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;

/**
 * When the webhook drain last ran, one row per named clock (only `drain` exists): the shared
 * throttle that lets at most one activity-driven drain through per interval (same conditional
 * upsert as `demo_tick_state`). Not history; the row is overwritten on every drain.
 */
export const webhookDrainState = pgTable("webhook_drain_state", {
  name: text("name").primaryKey(),
  lastRunAt: timestamptz("last_run_at").notNull(),
});
