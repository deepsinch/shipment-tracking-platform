import "server-only";

import { randomUUID } from "node:crypto";

import { and, arrayContains, eq, inArray } from "drizzle-orm";

import type { DeliveryProofSummary } from "@/domain/delivery-proof";
import type { WebhookEventType } from "@/domain/webhooks";
import type { Transaction } from "@/server/db/client";
import {
  user,
  webhookDeliveries,
  webhookEndpoints,
  type Shipment,
  type ShipmentEvent,
} from "@/server/db/schema";
import {
  envelope,
  toDriverAssignedData,
  toShipmentCreatedData,
  toStatusChangedData,
  type StatusChangeEvent,
} from "@/server/webhooks/payloads";

/**
 * The webhook outbox: services call these inside the transaction that made the change, next to
 * the realtime announcement. A delivery row therefore exists only if the change committed, and a
 * rolled-back change leaves nothing to send. Nothing here talks to the network; delivery happens
 * later (`webhook-delivery.ts`).
 *
 * One delivery is queued per enabled endpoint of the organization that subscribed to the event
 * type. Without a matching endpoint the payload is never even built.
 */

async function enqueue(
  tx: Transaction,
  organizationId: string,
  type: WebhookEventType,
  createdAt: Date,
  buildData: () => Promise<unknown> | unknown,
): Promise<void> {
  const endpoints = await tx
    .select({ id: webhookEndpoints.id })
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.organizationId, organizationId),
        eq(webhookEndpoints.enabled, true),
        arrayContains(webhookEndpoints.eventTypes, [type]),
      ),
    );
  if (endpoints.length === 0) return;

  const queuedAt = new Date();
  const payload = envelope(randomUUID(), type, createdAt, await buildData());
  await tx.insert(webhookDeliveries).values(
    endpoints.map((endpoint) => ({
      organizationId,
      endpointId: endpoint.id,
      eventId: payload.id,
      eventType: type,
      payload,
      // Due now: the caller's `after()` makes the first attempt as soon as the response is sent.
      nextAttemptAt: queuedAt,
    })),
  );
}

export function enqueueShipmentCreated(tx: Transaction, shipment: Shipment): Promise<void> {
  return enqueue(tx, shipment.organizationId, "shipment.created", shipment.createdAt, () =>
    toShipmentCreatedData(shipment),
  );
}

export function enqueueStatusChanged(
  tx: Transaction,
  shipment: Shipment,
  event: StatusChangeEvent & Pick<ShipmentEvent, "recordedAt">,
  proof: DeliveryProofSummary | null = null,
): Promise<void> {
  return enqueue(tx, shipment.organizationId, "shipment.status_changed", event.recordedAt, () =>
    toStatusChangedData(shipment, event, proof),
  );
}

export function enqueueDriverAssigned(
  tx: Transaction,
  shipment: Shipment,
  event: Pick<ShipmentEvent, "recordedAt">,
  drivers: { fromDriverId: string | null; toDriverId: string | null },
): Promise<void> {
  return enqueue(
    tx,
    shipment.organizationId,
    "shipment.driver_assigned",
    event.recordedAt,
    async () => {
      const ids = [drivers.fromDriverId, drivers.toDriverId].filter(
        (id): id is string => id !== null,
      );
      const rows =
        ids.length === 0
          ? []
          : await tx
              .select({ id: user.id, name: user.name })
              .from(user)
              .where(inArray(user.id, ids));
      const nameOf = (id: string | null) => rows.find((row) => row.id === id)?.name ?? null;
      return toDriverAssignedData(shipment, {
        fromName: nameOf(drivers.fromDriverId),
        toName: nameOf(drivers.toDriverId),
      });
    },
  );
}
