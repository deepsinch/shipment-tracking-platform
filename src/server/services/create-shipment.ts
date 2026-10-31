import "server-only";

import { z } from "zod";

import { SERVICE_LEVELS } from "@/domain/service-level";
import { canCreateShipments } from "@/domain/shipment-permissions";
import { generateTrackingCode } from "@/domain/tracking-code";
import type { AuthContext } from "@/server/auth/auth-context";
import { getDb, type Transaction } from "@/server/db/client";
import { shipmentEvents, shipments, type Shipment } from "@/server/db/schema";

import { isDriverInOrganization, NOT_AN_ORGANIZATION_DRIVER } from "./driver-membership";
import { forbidden, validationFailure, type Forbidden, type ValidationFailure } from "./results";
import { blankToUndefined, optionalCoordinate, optionalText } from "./validation";

const requiredText = (message: string, max = 200) =>
  z.string({ error: message }).trim().min(1, message).max(max, `Use at most ${max} characters`);

const countryCode = z
  .string({ error: "Enter a two-letter country code" })
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "Enter a two-letter country code, e.g. NL");

/**
 * Input for a new shipment. Field names match the columns and the form fields, so field errors map
 * straight onto inputs. Numbers and dates are coerced because HTML forms submit strings; blank
 * optional fields become undefined. The database CHECK constraints repeat the critical rules.
 */
export const createShipmentSchema = z.object({
  reference: optionalText(100),
  recipientName: requiredText("Enter the recipient's name"),
  recipientEmail: blankToUndefined(
    z.email("Enter a valid email address").trim().toLowerCase().max(254),
  ),

  originAddressLine: requiredText("Enter the pickup address"),
  originCity: requiredText("Enter the pickup city", 100),
  originPostalCode: optionalText(20),
  originCountry: countryCode,
  originLat: optionalCoordinate("latitude"),
  originLng: optionalCoordinate("longitude"),

  destinationAddressLine: requiredText("Enter the delivery address"),
  destinationCity: requiredText("Enter the delivery city", 100),
  destinationPostalCode: optionalText(20),
  destinationCountry: countryCode,
  destinationLat: optionalCoordinate("latitude"),
  destinationLng: optionalCoordinate("longitude"),

  weightKg: z.coerce
    .number({ error: "Enter the weight in kg" })
    .positive("Enter a weight above 0 kg")
    // numeric(10, 2) holds up to 99,999,999.99; a road shipment is far below this.
    .max(100_000, "Enter at most 100,000 kg"),
  serviceLevel: blankToUndefined(z.enum(SERVICE_LEVELS, { error: "Choose a service level" })),
  promisedDeliveryAt: blankToUndefined(z.coerce.date({ error: "Enter a valid date and time" })),
  assignedDriverId: optionalText(100),
});

export type CreateShipmentInput = z.input<typeof createShipmentSchema>;

export type CreateShipmentResult = { ok: true; shipment: Shipment } | Forbidden | ValidationFailure;

export type CreateShipmentDeps = {
  /** Injectable so tests can force a tracking code collision. */
  generateTrackingCode?: () => string;
  /**
   * The booking time (created_at and the created event). Injectable so the demo seed can book
   * shipments in the past and then replay their history through `changeShipmentStatus`.
   */
  now?: () => Date;
};

/** A collision needs two random 40-bit codes to match; five in a row means something is broken. */
const MAX_TRACKING_CODE_ATTEMPTS = 5;

/**
 * Books a new shipment: inserts it with a fresh tracking code plus its `created` history event, in
 * one transaction. Admins and dispatchers only.
 */
export async function createShipment(
  ctx: AuthContext,
  input: unknown,
  deps: CreateShipmentDeps = {},
): Promise<CreateShipmentResult> {
  const nextCode = deps.generateTrackingCode ?? generateTrackingCode;
  const bookedAt = deps.now?.() ?? new Date();

  if (!canCreateShipments(ctx.role)) return forbidden;

  const parsed = createShipmentSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const { assignedDriverId, ...fields } = parsed.data;

  const db = getDb();
  if (assignedDriverId && !(await isDriverInOrganization(assignedDriverId, ctx.organizationId))) {
    return {
      ok: false,
      reason: "validation",
      fieldErrors: { assignedDriverId: [NOT_AN_ORGANIZATION_DRIVER] },
    };
  }

  const shipment = await db.transaction(async (tx) => {
    const created = await insertWithUniqueTrackingCode(tx, nextCode, {
      ...fields,
      createdAt: bookedAt,
      updatedAt: bookedAt,
      assignedDriverId: assignedDriverId ?? null,
      organizationId: ctx.organizationId,
      createdBy: ctx.userId,
    });
    await tx.insert(shipmentEvents).values({
      organizationId: ctx.organizationId,
      shipmentId: created.id,
      type: "created",
      toStatus: created.status,
      occurredAt: created.createdAt,
      actorUserId: ctx.userId,
    });
    return created;
  });

  return { ok: true, shipment };
}

/**
 * Inserts the shipment, drawing a new tracking code whenever the unique index already holds one.
 *
 * `ON CONFLICT (tracking_code) DO NOTHING` turns a collision into "no row returned" instead of an
 * error. That matters inside a transaction: a failed statement aborts the whole transaction in
 * Postgres, so catching a unique violation would need a savepoint per attempt.
 */
async function insertWithUniqueTrackingCode(
  tx: Transaction,
  nextCode: () => string,
  values: Omit<typeof shipments.$inferInsert, "trackingCode">,
): Promise<Shipment> {
  for (let attempt = 1; attempt <= MAX_TRACKING_CODE_ATTEMPTS; attempt++) {
    const [row] = await tx
      .insert(shipments)
      .values({ ...values, trackingCode: nextCode() })
      .onConflictDoNothing({ target: shipments.trackingCode })
      .returning();
    if (row) return row;
  }
  throw new Error(
    `Could not generate a unique tracking code in ${MAX_TRACKING_CODE_ATTEMPTS} attempts`,
  );
}
