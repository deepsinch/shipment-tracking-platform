import { and, eq, type SQL } from "drizzle-orm";

import { seesAllOrganizationShipments } from "@/domain/shipment-permissions";
import type { AuthContext } from "@/server/auth/auth-context";
import { shipments } from "@/server/db/schema";

/**
 * The WHERE condition for "shipments this caller may see": always their own organization, and for
 * drivers only the shipments assigned to them. Every service that reads or changes a shipment
 * builds on it, so the tenant and role scope cannot be forgotten in one query. A shipment outside
 * the scope simply does not match, which callers report as not found (never forbidden).
 */
export function visibleShipments(ctx: AuthContext): SQL {
  const inOrganization = eq(shipments.organizationId, ctx.organizationId);
  if (seesAllOrganizationShipments(ctx.role)) return inOrganization;
  // `and` only returns undefined when given no conditions.
  return and(inOrganization, eq(shipments.assignedDriverId, ctx.userId))!;
}
