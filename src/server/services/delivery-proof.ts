import "server-only";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { asSignature, DEMO_SAMPLE_PHOTO_KEY, type Signature } from "@/domain/delivery-proof";
import { canViewDeliveryPhoto } from "@/domain/shipment-permissions";
import type { AuthContext } from "@/server/auth/auth-context";
import { getDb } from "@/server/db/client";
import { deliveryProofs, shipments, user } from "@/server/db/schema";
import { getPhotoStorage, type PhotoStorage, type StoredPhoto } from "@/server/storage";

import { forbidden, notFound, type Forbidden, type NotFound } from "./results";
import { visibleShipments } from "./shipment-access";

/**
 * A delivery's proof as staff see it. The photo's storage key never leaves the server: `photo`
 * says whether there is one, and the picture itself is fetched through the session-checked route
 * (`getDeliveryPhoto`).
 */
export type DeliveryProofView = {
  recipientName: string;
  /** Null when the recipient did not sign (or the stored strokes cannot be drawn). */
  signature: Signature | null;
  /** `sample` is the demo's placeholder; nothing real is stored for it. */
  photo: "none" | "stored" | "sample";
  capturedAt: Date;
  capturedByName: string;
};

/**
 * The proof of a shipment the caller can already see (the caller checked), or null for a delivery
 * without proof. An explicit column list, filtered by organization like every tenant query.
 */
export async function findDeliveryProof(
  organizationId: string,
  shipmentId: string,
): Promise<DeliveryProofView | null> {
  const [row] = await getDb()
    .select({
      recipientName: deliveryProofs.recipientName,
      signature: deliveryProofs.signature,
      photoKey: deliveryProofs.photoKey,
      capturedAt: deliveryProofs.capturedAt,
      capturedByName: user.name,
    })
    .from(deliveryProofs)
    .innerJoin(user, eq(user.id, deliveryProofs.capturedBy))
    .where(
      and(
        eq(deliveryProofs.shipmentId, shipmentId),
        eq(deliveryProofs.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    recipientName: row.recipientName,
    signature: asSignature(row.signature),
    photo:
      row.photoKey === null ? "none" : row.photoKey === DEMO_SAMPLE_PHOTO_KEY ? "sample" : "stored",
    capturedAt: row.capturedAt,
    capturedByName: row.capturedByName,
  };
}

export type GetDeliveryPhotoResult = ({ ok: true } & StoredPhoto) | NotFound | Forbidden;

/**
 * The delivery photo of a shipment, for staff only. Out-of-scope shipments, shipments without a
 * stored photo and the demo placeholder are all "not found" (the placeholder is a static image the
 * page links to, not a stored file); a driver is refused even for their own shipment.
 */
export async function getDeliveryPhoto(
  ctx: AuthContext,
  shipmentId: string,
  deps: { photoStorage?: PhotoStorage | null } = {},
): Promise<GetDeliveryPhotoResult> {
  if (!z.uuid().safeParse(shipmentId).success) return notFound;

  const [row] = await getDb()
    .select({ photoKey: deliveryProofs.photoKey })
    .from(shipments)
    .innerJoin(
      deliveryProofs,
      and(
        eq(deliveryProofs.shipmentId, shipments.id),
        eq(deliveryProofs.organizationId, shipments.organizationId),
      ),
    )
    .where(and(eq(shipments.id, shipmentId), visibleShipments(ctx)))
    .limit(1);
  if (!row?.photoKey || row.photoKey === DEMO_SAMPLE_PHOTO_KEY) return notFound;
  if (!canViewDeliveryPhoto(ctx.role)) return forbidden;

  const storage = deps.photoStorage === undefined ? getPhotoStorage() : deps.photoStorage;
  const photo = await storage?.get(row.photoKey);
  return photo ? { ok: true, ...photo } : notFound;
}
