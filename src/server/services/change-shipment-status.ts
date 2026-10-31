import "server-only";

import { and, eq, isNotNull, max, sql } from "drizzle-orm";
import { z } from "zod";

import { canSetStatus } from "@/domain/shipment-permissions";
import { canTransition, SHIPMENT_STATUSES, type ShipmentStatus } from "@/domain/shipment-status";
import type { AuthContext } from "@/server/auth/auth-context";
import { getDb, type Transaction } from "@/server/db/client";
import { shipmentEvents, shipments, type Shipment, type ShipmentEvent } from "@/server/db/schema";

import {
  forbidden,
  notFound,
  validationFailure,
  type Forbidden,
  type NotFound,
  type ValidationFailure,
} from "./results";
import { visibleShipments } from "./shipment-access";
import { blankToUndefined, optionalCoordinate, optionalText } from "./validation";

/** Tolerated clock difference between a driver's device and the server. */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export const changeShipmentStatusSchema = z.object({
  shipmentId: z.uuid(),
  /** The `version` the user saw when they opened the form. */
  expectedVersion: z.coerce.number().int().min(1),
  toStatus: z.enum(SHIPMENT_STATUSES, { error: "Choose a status" }),
  /** When it happened in the real world; defaults to now. May be backdated, not future-dated. */
  occurredAt: blankToUndefined(
    z.coerce
      .date({ error: "Enter a valid date and time" })
      .refine(
        (date) => date.getTime() <= Date.now() + MAX_CLOCK_SKEW_MS,
        "The time cannot be in the future",
      ),
  ),
  /** Shown to the customer on the public tracking page. */
  publicNote: optionalText(500),
  /** Visible to the organization only. */
  internalNote: optionalText(1000),
  location: z
    .object({
      city: optionalText(100),
      lat: optionalCoordinate("latitude"),
      lng: optionalCoordinate("longitude"),
    })
    .optional(),
});

export type ChangeShipmentStatusInput = z.input<typeof changeShipmentStatusSchema>;

export type ChangeShipmentStatusResult =
  | { ok: true; shipment: Shipment; event: ShipmentEvent }
  | { ok: false; reason: "invalid_transition"; from: ShipmentStatus; to: ShipmentStatus }
  /** Someone else changed the shipment first; `current` is the fresh data to show the user. */
  | { ok: false; reason: "conflict"; current: Shipment }
  /** The caller can see the shipment but their role may not set this status. */
  | Forbidden
  | NotFound
  | ValidationFailure;

/**
 * Moves a shipment to a new status: state machine check, optimistic concurrency on `version`, and
 * the `status_changed` history event, all in one transaction.
 *
 * Who may change what (Phase 1): admins and dispatchers any shipment in their organization, drivers
 * only shipments assigned to them, and never to `cancelled` (forbidden, see `canSetStatus`).
 * Shipments outside the caller's scope are not found, so a driver cannot learn which exist.
 *
 * `occurredAt` may be backdated, but not before the shipment's latest status event, so the status
 * timeline (ordered by occurred_at) always follows the state machine. Events without a status
 * (driver assignments) do not count: a driver who was offline may record a pickup that happened
 * before the office reassigned the shipment to them.
 */
export async function changeShipmentStatus(
  ctx: AuthContext,
  input: unknown,
): Promise<ChangeShipmentStatusResult> {
  const parsed = changeShipmentStatusSchema.safeParse(input);
  if (!parsed.success) {
    // A malformed id cannot match any shipment: report it like any other unknown id.
    const badId = parsed.error.issues.some((issue) => issue.path[0] === "shipmentId");
    return badId ? notFound : validationFailure(parsed.error);
  }
  const { shipmentId, expectedVersion, toStatus, occurredAt, publicNote, internalNote, location } =
    parsed.data;

  return getDb().transaction(async (tx): Promise<ChangeShipmentStatusResult> => {
    const current = await findVisibleShipment(tx, ctx, shipmentId);
    if (!current) return notFound;
    // The shipment is visible to the caller, so saying "not allowed" reveals nothing.
    if (!canSetStatus(ctx.role, toStatus)) return forbidden;

    // Version before transition: if the user's form is stale, the transition they picked was based
    // on a status that no longer holds, so "someone else changed this" is the useful answer.
    if (current.version !== expectedVersion) return { ok: false, reason: "conflict", current };
    if (!canTransition(current.status, toStatus)) {
      return { ok: false, reason: "invalid_transition", from: current.status, to: toStatus };
    }

    // Read inside the transaction: a concurrent change that adds a later event also bumps the
    // version, so the guarded UPDATE below rejects us and this check cannot go stale.
    const latestOccurredAt = await latestStatusEventTime(tx, ctx, shipmentId);
    if (occurredAt && latestOccurredAt && occurredAt < latestOccurredAt) {
      return {
        ok: false,
        reason: "validation",
        fieldErrors: {
          occurredAt: [`Must be after the previous update (${latestOccurredAt.toISOString()})`],
        },
      };
    }
    // Defaulting to now could still land before an event recorded with a slightly fast device
    // clock (see MAX_CLOCK_SKEW_MS); never order the new event before it.
    const now = new Date();
    const eventTime =
      occurredAt ?? (latestOccurredAt && latestOccurredAt > now ? latestOccurredAt : now);

    // The version check above is only a fast path for stale forms. This guarded UPDATE is what
    // actually prevents lost updates: if a concurrent transaction changed the row after our read,
    // Postgres re-checks `version = expected` once that transaction commits, matches zero rows, and
    // we report a conflict instead of overwriting.
    const [updated] = await tx
      .update(shipments)
      .set({ status: toStatus, version: sql`${shipments.version} + 1` })
      .where(
        and(
          eq(shipments.id, shipmentId),
          visibleShipments(ctx),
          eq(shipments.version, expectedVersion),
        ),
      )
      .returning();
    if (!updated) {
      const latest = await findVisibleShipment(tx, ctx, shipmentId);
      return latest ? { ok: false, reason: "conflict", current: latest } : notFound;
    }

    const [event] = await tx
      .insert(shipmentEvents)
      .values({
        organizationId: ctx.organizationId,
        shipmentId,
        type: "status_changed",
        // Safe to take from the earlier read: the UPDATE matched the same version, so the status
        // has not changed in between.
        fromStatus: current.status,
        toStatus,
        occurredAt: eventTime,
        actorUserId: ctx.userId,
        locationCity: location?.city,
        locationLat: location?.lat,
        locationLng: location?.lng,
        publicNote,
        internalNote,
      })
      .returning();

    return { ok: true, shipment: updated, event: event! };
  });
}

async function findVisibleShipment(
  tx: Transaction,
  ctx: AuthContext,
  shipmentId: string,
): Promise<Shipment | undefined> {
  const [shipment] = await tx
    .select()
    .from(shipments)
    .where(and(eq(shipments.id, shipmentId), visibleShipments(ctx)))
    .limit(1);
  return shipment;
}

/** When the shipment's latest status event (created or status_changed) happened. */
async function latestStatusEventTime(
  tx: Transaction,
  ctx: AuthContext,
  shipmentId: string,
): Promise<Date | null> {
  const [row] = await tx
    .select({ latest: max(shipmentEvents.occurredAt) })
    .from(shipmentEvents)
    .where(
      and(
        eq(shipmentEvents.shipmentId, shipmentId),
        eq(shipmentEvents.organizationId, ctx.organizationId),
        isNotNull(shipmentEvents.toStatus),
      ),
    );
  return row?.latest ?? null;
}
