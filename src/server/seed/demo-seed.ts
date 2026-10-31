import "server-only";

import { eq } from "drizzle-orm";

import type { Role } from "@/domain/roles";
import type { AuthContext } from "@/server/auth/auth-context";
import { getAuth } from "@/server/auth/auth";
import { signUpWithOrganization } from "@/server/auth/sign-up";
import { getDb } from "@/server/db/client";
import { user } from "@/server/db/schema";
import { changeShipmentStatus } from "@/server/services/change-shipment-status";
import { createShipment } from "@/server/services/create-shipment";
import { recordLocationPing } from "@/server/services/record-location-ping";

import { draftDemoShipments, type DraftShipment } from "./demo-data";

/**
 * Demo data for "Demo Freight Co": three accounts (one per role) and 30 shipments across every
 * status. Everything goes through the real code paths: users through Better Auth (hashed
 * passwords), shipments through `createShipment` and history through `changeShipmentStatus`, so
 * every timeline obeys the state machine, the role rules and the event-time ordering. The demo
 * driver's unfinished shipments get a last known position through `recordLocationPing`, so the
 * live map has something to show before any simulator runs.
 *
 * Re-running is a no-op once the demo admin exists: history cannot be deleted, so the seed never
 * tries to "refresh" rows. `pnpm db:seed --reset` wipes the local dev database first instead.
 */

export const DEMO_ORGANIZATION_NAME = "Demo Freight Co";
/** Demo-only credentials, published in the README. */
export const DEMO_PASSWORD = "demo-password";

export const DEMO_USERS = [
  { role: "admin", name: "Alex Admin", email: "admin@demo.test" },
  { role: "dispatcher", name: "Dana Dispatcher", email: "dispatcher@demo.test" },
  { role: "driver", name: "Dries Driver", email: "driver@demo.test" },
] as const satisfies readonly { role: Role; name: string; email: string }[];

export type SeedResult =
  | { status: "seeded"; organizationId: string; shipmentCount: number }
  | { status: "skipped"; reason: string };

export async function seedDemo({ now = new Date() }: { now?: Date } = {}): Promise<SeedResult> {
  const admin = DEMO_USERS[0];
  const [existing] = await getDb()
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, admin.email));
  if (existing) return { status: "skipped", reason: `${admin.email} already exists` };

  const contexts = await createDemoAccounts();
  const drafts = draftDemoShipments(now);
  for (const draft of drafts) await seedShipment(draft, contexts);

  return {
    status: "seeded",
    organizationId: contexts.dispatcher.organizationId,
    shipmentCount: drafts.length,
  };
}

async function createDemoAccounts(): Promise<Record<Role, AuthContext>> {
  const [admin, dispatcher, driver] = DEMO_USERS;
  const signUp = await signUpWithOrganization({
    name: admin.name,
    email: admin.email,
    password: DEMO_PASSWORD,
    organizationName: DEMO_ORGANIZATION_NAME,
  });
  if (!signUp.ok) throw new Error(`Could not create the demo admin: ${JSON.stringify(signUp)}`);
  const { organizationId } = signUp;

  const auth = getAuth();
  const member = async (account: (typeof DEMO_USERS)[number]): Promise<AuthContext> => {
    const { user: created } = await auth.api.signUpEmail({
      body: { name: account.name, email: account.email, password: DEMO_PASSWORD },
    });
    await auth.api.addMember({
      body: { userId: created.id, organizationId, role: account.role },
    });
    return { userId: created.id, organizationId, role: account.role };
  };

  return {
    admin: { userId: signUp.userId, organizationId, role: "admin" },
    dispatcher: await member(dispatcher),
    driver: await member(driver),
  };
}

async function seedShipment(
  draft: DraftShipment,
  contexts: Record<Role, AuthContext>,
): Promise<void> {
  const { index, origin, destination, assignedToDemoDriver: assigned } = draft;
  const created = await createShipment(
    contexts.dispatcher,
    {
      reference: draft.reference,
      recipientName: draft.recipientName,
      recipientEmail: draft.recipientEmail,
      originAddressLine: origin.address,
      originCity: origin.city,
      originPostalCode: origin.postalCode,
      originCountry: origin.country,
      originLat: origin.lat,
      originLng: origin.lng,
      destinationAddressLine: destination.address,
      destinationCity: destination.city,
      destinationPostalCode: destination.postalCode,
      destinationCountry: destination.country,
      destinationLat: destination.lat,
      destinationLng: destination.lng,
      weightKg: draft.weightKg,
      serviceLevel: draft.serviceLevel,
      promisedDeliveryAt: draft.promisedDeliveryAt,
      assignedDriverId: assigned ? contexts.driver.userId : "",
    },
    { now: () => draft.createdAt },
  );
  if (!created.ok) throw new Error(`Seed shipment ${index} rejected: ${JSON.stringify(created)}`);

  let version = created.shipment.version;
  for (const [
    step,
    { toStatus, occurredAt, publicNote, internalNote, place },
  ] of draft.steps.entries()) {
    // Drivers record their own shipments' progress; cancelling is always the office's call.
    const actor = assigned && toStatus !== "cancelled" ? contexts.driver : contexts.dispatcher;

    const result = await changeShipmentStatus(actor, {
      shipmentId: created.shipment.id,
      expectedVersion: version,
      toStatus,
      occurredAt,
      publicNote,
      internalNote,
      location: { city: place.city, lat: place.lat, lng: place.lng },
    });
    if (!result.ok) {
      throw new Error(`Seed shipment ${index} -> ${toStatus} rejected: ${JSON.stringify(result)}`);
    }
    version = result.shipment.version;

    if (draft.lastPing?.afterStep === step) {
      await seedPosition(contexts.driver, created.shipment.id, draft);
    }
  }
}

async function seedPosition(
  driver: AuthContext,
  shipmentId: string,
  { index, origin, destination, lastPing }: DraftShipment,
): Promise<void> {
  if (!lastPing) return;
  const { progress, at: recordedAt } = lastPing;
  const result = await recordLocationPing(
    driver,
    {
      shipmentId,
      lat: round(origin.lat + (destination.lat - origin.lat) * progress),
      lng: round(origin.lng + (destination.lng - origin.lng) * progress),
      accuracyM: 12,
      recordedAt,
    },
    // Received a moment after the fix, as from a phone with a decent connection.
    { now: () => new Date(recordedAt.getTime() + 3_000) },
  );
  if (!result.ok || !result.accepted) {
    throw new Error(`Seed position for shipment ${index} rejected: ${JSON.stringify(result)}`);
  }
}

const round = (degrees: number) => Math.round(degrees * 1e5) / 1e5;
