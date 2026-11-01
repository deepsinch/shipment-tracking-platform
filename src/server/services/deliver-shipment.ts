import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  cleanPhoto,
  type CleanedPhoto,
  deliveryProofInputSchema,
  PHOTO_EXTENSIONS,
  PHOTO_MAX_BYTES,
  PHOTO_REJECTION_MESSAGES,
  type DeliveryProofRecord,
} from "@/domain/delivery-proof";
import { canSetStatus } from "@/domain/shipment-permissions";
import type { AuthContext } from "@/server/auth/auth-context";
import { getDb } from "@/server/db/client";
import { shipments } from "@/server/db/schema";
import { getPhotoStorage, type PhotoStorage } from "@/server/storage";

import {
  changeShipmentStatus,
  type ChangeShipmentStatusDeps,
  type ChangeShipmentStatusResult,
} from "./change-shipment-status";
import { fieldErrorsOf, forbidden, notFound, type FieldErrors } from "./results";
import { visibleShipments } from "./shipment-access";

export type DeliverShipmentInput = {
  shipmentId: string;
  expectedVersion: unknown;
  occurredAt?: unknown;
  publicNote?: unknown;
  internalNote?: unknown;
  location?: unknown;
  /** The recipient's printed name. */
  recipientName: unknown;
  /** The signature's strokes: the JSON string the driver app sends, or the parsed object. */
  signature?: unknown;
  /** The photo, if the driver took one. Needs photo storage; refused without it. */
  photo?: Blob | null;
};

export type DeliverShipmentDeps = Omit<ChangeShipmentStatusDeps, "proof"> & {
  /** Where photos go; defaults to the deployment's storage (null when photos are off). */
  photoStorage?: PhotoStorage | null;
};

export type DeliverShipmentResult =
  | ChangeShipmentStatusResult
  /** The photo is fine but storage failed; nothing was changed, so the driver can retry. */
  | { ok: false; reason: "photo_failed" };

/**
 * Marks a shipment delivered with proof: the recipient's printed name, an optional drawn
 * signature and an optional photo. This is the driver app's delivery, and it composes
 * `changeShipmentStatus` (state machine, concurrency, event, outbox) so the proof is written in
 * the same transaction as the `delivered` event: no event without its proof, no proof without its
 * event.
 *
 * The photo cannot join a database transaction, so the order is: validate everything; check the
 * caller may touch this shipment at all (a driver cannot put files into storage for a shipment
 * that is not theirs); store the photo under an unguessable key; run the transaction; and delete
 * the photo again if the transaction did not commit. A crash between the upload and the delete
 * leaves an unreferenced private file, not a wrong record.
 *
 * Photo handling: the real type comes from the file's magic bytes (the client's claim is
 * ignored), the size is capped, and location metadata is stripped before anything is stored.
 */
export async function deliverShipment(
  ctx: AuthContext,
  input: DeliverShipmentInput,
  deps: DeliverShipmentDeps = {},
): Promise<DeliverShipmentResult> {
  const { photoStorage: storageOverride, ...statusDeps } = deps;
  const storage = storageOverride === undefined ? getPhotoStorage() : storageOverride;
  const { recipientName, signature, photo, ...status } = input;

  if (!z.uuid().safeParse(status.shipmentId).success) return notFound;

  const parsed = deliveryProofInputSchema.safeParse({ recipientName, signature });
  // `signature.strokes` and the like fold onto the one field the form shows.
  const fieldErrors: FieldErrors = {};
  if (!parsed.success) {
    for (const [key, messages] of Object.entries(fieldErrorsOf(parsed.error))) {
      // One message per field is all a form shows; a broken stroke list would otherwise repeat it.
      fieldErrors[key.startsWith("signature") ? "signature" : key] ??= messages.slice(0, 1);
    }
  }
  const cleaned = photo ? await readPhoto(photo, storage) : null;
  if (cleaned && !cleaned.ok) fieldErrors.photo = [cleaned.message];
  if (!parsed.success || (cleaned && !cleaned.ok)) {
    return { ok: false, reason: "validation", fieldErrors };
  }

  let photoKey: string | null = null;
  if (cleaned?.ok && storage) {
    // Only someone who may deliver this shipment can put a file next to it.
    const [visible] = await getDb()
      .select({ id: shipments.id })
      .from(shipments)
      .where(and(eq(shipments.id, status.shipmentId), visibleShipments(ctx)))
      .limit(1);
    if (!visible) return notFound;
    if (!canSetStatus(ctx.role, "delivered")) return forbidden;

    const key = `delivery-proofs/${ctx.organizationId}/${status.shipmentId}/${randomUUID()}.${PHOTO_EXTENSIONS[cleaned.photo.contentType]}`;
    try {
      await storage.put(key, cleaned.photo.bytes, cleaned.photo.contentType);
    } catch (error) {
      console.error("Delivery photo upload failed", error);
      return { ok: false, reason: "photo_failed" };
    }
    photoKey = key;
  }

  const proof: DeliveryProofRecord = {
    recipientName: parsed.data.recipientName,
    signature: parsed.data.signature ?? null,
    photoKey,
  };

  let result: ChangeShipmentStatusResult;
  try {
    result = await changeShipmentStatus(
      ctx,
      { ...status, toStatus: "delivered" },
      {
        ...statusDeps,
        proof,
      },
    );
  } catch (error) {
    await discard(storage, photoKey);
    throw error;
  }
  if (!result.ok) await discard(storage, photoKey);
  return result;
}

type PhotoCheck = { ok: true; photo: CleanedPhoto } | { ok: false; message: string };

async function readPhoto(photo: Blob, storage: PhotoStorage | null): Promise<PhotoCheck> {
  if (!storage) return { ok: false, message: "Photos are not available here." };
  // Checked before reading: a huge body is never pulled into memory.
  if (photo.size > PHOTO_MAX_BYTES) {
    return { ok: false, message: PHOTO_REJECTION_MESSAGES.too_large };
  }
  const result = cleanPhoto(new Uint8Array(await photo.arrayBuffer()));
  return result.ok
    ? { ok: true, photo: result.photo }
    : { ok: false, message: PHOTO_REJECTION_MESSAGES[result.reason] };
}

/** Best effort: a failed delete leaves an unreferenced private file, which must not hide the real result. */
async function discard(storage: PhotoStorage | null, key: string | null): Promise<void> {
  if (!storage || !key) return;
  try {
    await storage.delete(key);
  } catch (error) {
    console.error("Could not remove an unused delivery photo", error);
  }
}
