import "server-only";

import { and, count, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { z } from "zod";

import { SHIPMENT_STATUSES } from "@/domain/shipment-status";
import { normalizeTrackingCode } from "@/domain/tracking-code";
import type { AuthContext } from "@/server/auth/auth-context";
import { getDb } from "@/server/db/client";
import { shipments, type Shipment } from "@/server/db/schema";

import { validationFailure, type ValidationFailure } from "./results";
import { visibleShipments } from "./shipment-access";
import { blankToUndefined, optionalText } from "./validation";

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

/** Query for the dashboard table. Coerced because it usually comes from URL search params. */
export const listShipmentsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  status: blankToUndefined(z.enum(SHIPMENT_STATUSES)),
  search: optionalText(100),
});

/** Columns the dashboard table needs; the detail page loads the full row. */
const listColumns = {
  id: shipments.id,
  trackingCode: shipments.trackingCode,
  status: shipments.status,
  reference: shipments.reference,
  recipientName: shipments.recipientName,
  originCity: shipments.originCity,
  originCountry: shipments.originCountry,
  destinationCity: shipments.destinationCity,
  destinationCountry: shipments.destinationCountry,
  serviceLevel: shipments.serviceLevel,
  promisedDeliveryAt: shipments.promisedDeliveryAt,
  assignedDriverId: shipments.assignedDriverId,
  createdAt: shipments.createdAt,
} as const;

export type ShipmentListItem = Pick<Shipment, keyof typeof listColumns>;

export type ListShipmentsQuery = z.input<typeof listShipmentsSchema>;

export type ShipmentPage = {
  rows: ShipmentListItem[];
  /** Matching shipments across all pages. */
  total: number;
  page: number;
  pageSize: number;
};

export type ListShipmentsResult = ({ ok: true } & ShipmentPage) | ValidationFailure;

/**
 * One page of the caller's visible shipments, newest first, with the total for pagination.
 *
 * The organization filter plus `created_at DESC` matches the `shipments_org_created_at_idx` (or,
 * with a status filter, `shipments_org_status_created_at_idx`) index. `id` breaks ties between
 * shipments created in the same instant, so rows never repeat or vanish across pages.
 */
export async function listShipments(
  ctx: AuthContext,
  query: unknown = {},
): Promise<ListShipmentsResult> {
  const parsed = listShipmentsSchema.safeParse(query);
  if (!parsed.success) return validationFailure(parsed.error);
  const { page, pageSize, status, search } = parsed.data;

  const where = and(
    visibleShipments(ctx),
    status ? eq(shipments.status, status) : undefined,
    search ? matchesSearch(search) : undefined,
  );

  const db = getDb();
  const [rows, [totals]] = await Promise.all([
    db
      .select(listColumns)
      .from(shipments)
      .where(where)
      .orderBy(desc(shipments.createdAt), desc(shipments.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(shipments).where(where),
  ]);

  return { ok: true, rows, total: totals?.total ?? 0, page, pageSize };
}

/**
 * A search term matches the exact tracking code (normalized, so `wb7k3mq9tx` finds `WB-7K3M-Q9TX`)
 * or any part of the customer reference, case-insensitively.
 */
function matchesSearch(search: string): SQL | undefined {
  const referenceMatch = ilike(shipments.reference, `%${escapeLikePattern(search)}%`);
  const trackingCode = normalizeTrackingCode(search);
  return trackingCode
    ? or(eq(shipments.trackingCode, trackingCode), referenceMatch)
    : referenceMatch;
}

/** Makes `%`, `_` and `\` in user input match literally in a LIKE pattern. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
