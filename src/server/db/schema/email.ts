import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  EMAIL_MESSAGE_STATUSES,
  EMAIL_TRANSPORTS,
  type EmailMessageStatus,
  type EmailTransportName,
} from "@/domain/email";

import { organization } from "./auth";
import { shipments } from "./shipments";

const literalList = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");
const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/**
 * Customer emails: the outbox, the sent log and the preview store in one table. The message is
 * rendered when it is queued (inside the status change's transaction) and stored as it will be
 * sent, so a retry is byte-for-byte the same message, staff see exactly what the customer got, and
 * the preview transport has nothing left to do but mark it. A sibling of `webhook_deliveries`
 * rather than a new kind in it: the columns that matter differ (recipient, subject, bodies,
 * provider message id, no endpoint) and the two drains never need to see each other's rows.
 */
export const emailMessages = pgTable(
  "email_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id").notNull(),
    shipmentId: uuid("shipment_id").notNull(),
    /** Lower-cased address the shipment was booked with. */
    recipient: text("recipient").notNull(),
    subject: text("subject").notNull(),
    textBody: text("text_body").notNull(),
    htmlBody: text("html_body").notNull(),
    /** Sent to Resend as `Idempotency-Key`; stable across retries because it is stored. */
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").$type<EmailMessageStatus>().notNull().default("pending"),
    /** Attempts started, as for webhook deliveries. */
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamptz("next_attempt_at"),
    lastAttemptAt: timestamptz("last_attempt_at"),
    lastError: text("last_error"),
    /** Set when `succeeded`: which transport took the message. */
    transport: text("transport").$type<EmailTransportName>(),
    /** The provider's id for a sent message (Resend). */
    providerMessageId: text("provider_message_id"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "email_messages_shipment_org_fk",
      columns: [table.shipmentId, table.organizationId],
      foreignColumns: [shipments.id, shipments.organizationId],
    }).onDelete("restrict"),
    uniqueIndex("email_messages_idempotency_key_idx").on(table.idempotencyKey),
    index("email_messages_due_idx")
      .on(table.nextAttemptAt, table.id)
      .where(sql`${table.status} IN ('pending', 'failed')`),
    index("email_messages_shipment_created_at_idx").on(table.shipmentId, table.createdAt),
    index("email_messages_org_created_at_idx").on(table.organizationId, table.createdAt),
    check(
      "email_messages_status_known",
      sql`${table.status} IN (${sql.raw(literalList(EMAIL_MESSAGE_STATUSES))})`,
    ),
    check(
      "email_messages_transport_known",
      sql`${table.transport} IS NULL OR ${table.transport} IN (${sql.raw(literalList(EMAIL_TRANSPORTS))})`,
    ),
    // Open rows are due at some time, finished ones are not; a transport is named exactly when
    // the message was handed to one.
    check(
      "email_messages_next_attempt_matches_status",
      sql`(${table.status} IN ('pending', 'failed')) = (${table.nextAttemptAt} IS NOT NULL)`,
    ),
    check(
      "email_messages_transport_matches_status",
      sql`(${table.status} = 'succeeded') = (${table.transport} IS NOT NULL)`,
    ),
    check("email_messages_attempts_not_negative", sql`${table.attempts} >= 0`),
  ],
);

export type EmailMessageRow = typeof emailMessages.$inferSelect;

/**
 * Addresses that asked to stop receiving notifications from an organization. Per organization and
 * address (not per shipment), so it covers the customer's future shipments too. Not history: an
 * opt-out is a current preference, and a row is only ever inserted.
 */
export const emailOptOuts = pgTable(
  "email_opt_outs",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    email: text("email").notNull(),
    optedOutAt: timestamptz("opted_out_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.email] }),
    check("email_opt_outs_email_lowercase", sql`${table.email} = lower(${table.email})`),
  ],
);
