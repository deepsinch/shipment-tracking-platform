import { randomUUID } from "node:crypto";

import { generateTrackingCode } from "@/domain/tracking-code";
import { db } from "@/server/db/client";
import { member, organization, shipmentEvents, shipments, user } from "@/server/db/schema";
import type { NewShipment, Shipment } from "@/server/db/schema";

/**
 * Minimal rows for integration tests. Each call uses fresh random ids, so tests never share data
 * and need no cleanup (history rows cannot be deleted anyway; the global setup resets the DB).
 */

export async function createTestOrganization(name = "Test Org") {
  const id = randomUUID();
  const [org] = await db
    .insert(organization)
    .values({ id, name, slug: `test-${id}`, createdAt: new Date() })
    .returning();
  return org!;
}

export async function createTestUser(
  organizationId: string,
  role: "admin" | "dispatcher" | "driver" = "dispatcher",
) {
  const id = randomUUID();
  const [created] = await db
    .insert(user)
    .values({ id, name: `Test ${role}`, email: `${id}@example.test` })
    .returning();
  await db
    .insert(member)
    .values({ id: randomUUID(), organizationId, userId: id, role, createdAt: new Date() });
  return created!;
}

/** Inserts a shipment plus its `created` event, like the real service does. */
export async function createTestShipment(
  organizationId: string,
  createdBy: string,
  overrides: Partial<NewShipment> = {},
): Promise<Shipment> {
  const [shipment] = await db
    .insert(shipments)
    .values({
      organizationId,
      createdBy,
      trackingCode: generateTrackingCode(),
      recipientName: "Ada Recipient",
      originAddressLine: "1 Origin Street",
      originCity: "Rotterdam",
      originCountry: "NL",
      destinationAddressLine: "2 Destination Road",
      destinationCity: "Antwerp",
      destinationCountry: "BE",
      weightKg: 12.5,
      ...overrides,
    })
    .returning();
  await db.insert(shipmentEvents).values({
    organizationId,
    shipmentId: shipment!.id,
    type: "created",
    toStatus: shipment!.status,
    occurredAt: shipment!.createdAt,
    actorUserId: createdBy,
  });
  return shipment!;
}

/** Postgres SQLSTATE of a failed query, unwrapping Drizzle's error wrapper. */
export function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  while (current && typeof current === "object") {
    if ("code" in current && typeof current.code === "string") return current.code;
    current = "cause" in current ? current.cause : undefined;
  }
  return undefined;
}
