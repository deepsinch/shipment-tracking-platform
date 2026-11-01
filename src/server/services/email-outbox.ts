import "server-only";

import { and, eq } from "drizzle-orm";

import { shouldEmailForStatus } from "@/domain/email";
import type { Transaction } from "@/server/db/client";
import {
  emailMessages,
  emailOptOuts,
  organization,
  type Shipment,
  type ShipmentEvent,
} from "@/server/db/schema";
import { renderStatusEmail } from "@/server/email/templates";
import { trackingUrlFor, unsubscribeUrlFor } from "@/server/email/unsubscribe";

/**
 * Queues the customer's status email inside the status change's transaction, next to the realtime
 * announcement and the webhook outbox: the message exists only if the change committed. Nothing
 * here talks to the network.
 *
 * Skipped silently when the status is not one customers are told about, when the shipment has no
 * recipient address, or when that address opted out of this organization's emails. The message is
 * rendered here and stored as it will be sent. Only the event's public note goes in; the
 * template has no way to receive the internal note.
 */
export async function enqueueStatusEmail(
  tx: Transaction,
  shipment: Shipment,
  event: Pick<ShipmentEvent, "id" | "publicNote">,
  queuedAt: Date = new Date(),
): Promise<void> {
  const recipient = shipment.recipientEmail?.trim().toLowerCase();
  if (!recipient || !shouldEmailForStatus(shipment.status)) return;

  const [optedOut] = await tx
    .select({ email: emailOptOuts.email })
    .from(emailOptOuts)
    .where(
      and(
        eq(emailOptOuts.organizationId, shipment.organizationId),
        eq(emailOptOuts.email, recipient),
      ),
    )
    .limit(1);
  if (optedOut) return;

  const [company] = await tx
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, shipment.organizationId))
    .limit(1);

  const message = renderStatusEmail({
    companyName: company?.name ?? "Your carrier",
    recipientName: shipment.recipientName,
    status: shipment.status,
    trackingCode: shipment.trackingCode,
    originCity: shipment.originCity,
    destinationCity: shipment.destinationCity,
    publicNote: event.publicNote,
    trackingUrl: trackingUrlFor(shipment.trackingCode),
    unsubscribeUrl: unsubscribeUrlFor({
      organizationId: shipment.organizationId,
      email: recipient,
    }),
  });

  await tx
    .insert(emailMessages)
    .values({
      organizationId: shipment.organizationId,
      shipmentId: shipment.id,
      recipient,
      subject: message.subject,
      textBody: message.text,
      htmlBody: message.html,
      // One email per event, whatever happens later: the unique index enforces it, and Resend
      // deduplicates a retry of the same request by the same key.
      idempotencyKey: `waybill-status-email/${event.id}`,
      nextAttemptAt: queuedAt,
    })
    .onConflictDoNothing({ target: emailMessages.idempotencyKey });
}
