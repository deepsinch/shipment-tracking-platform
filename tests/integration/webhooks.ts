import { randomUUID } from "node:crypto";

import { getDb } from "@/server/db/client";
import {
  webhookDeliveries,
  webhookEndpoints,
  type WebhookDeliveryRow,
  type WebhookEndpointRow,
} from "@/server/db/schema";
import { generateWebhookSecret } from "@/server/services/webhook-endpoints";
import { WEBHOOK_EVENT_TYPES } from "@/domain/webhooks";

/** An endpoint row, inserted directly (the service would refuse a local test receiver's URL). */
export async function insertEndpoint(
  organizationId: string,
  createdBy: string,
  overrides: Partial<typeof webhookEndpoints.$inferInsert> = {},
): Promise<WebhookEndpointRow> {
  const [row] = await getDb()
    .insert(webhookEndpoints)
    .values({
      organizationId,
      createdBy,
      url: "https://webhooks.invalid/in",
      secret: generateWebhookSecret(),
      eventTypes: [...WEBHOOK_EVENT_TYPES],
      ...overrides,
    })
    .returning();
  return row!;
}

/** A pending delivery that is due at `dueAt` (default: long ago, so any drain picks it up). */
export async function insertDelivery(
  endpoint: Pick<WebhookEndpointRow, "id" | "organizationId">,
  overrides: Partial<typeof webhookDeliveries.$inferInsert> = {},
): Promise<WebhookDeliveryRow> {
  const eventId = randomUUID();
  const [row] = await getDb()
    .insert(webhookDeliveries)
    .values({
      organizationId: endpoint.organizationId,
      endpointId: endpoint.id,
      eventId,
      eventType: "shipment.status_changed",
      payload: {
        id: eventId,
        type: "shipment.status_changed",
        createdAt: "2030-01-01T00:00:00Z",
        data: {},
      },
      nextAttemptAt: new Date("2000-01-01T00:00:00Z"),
      ...overrides,
    })
    .returning();
  return row!;
}
