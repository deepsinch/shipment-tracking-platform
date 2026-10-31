import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { canAssignDrivers } from "@/domain/shipment-permissions";
import type { AuthContext } from "@/server/auth/auth-context";
import { getDb } from "@/server/db/client";
import { member, user } from "@/server/db/schema";

import { forbidden, type Forbidden } from "./results";

export type DriverOption = { id: string; name: string; email: string };

export type ListDriversResult = { ok: true; drivers: DriverOption[] } | Forbidden;

/**
 * The organization's drivers, for the "assign a driver" choice. Admins and dispatchers only: a
 * driver has no use for the staff list. Sorted by name, with the id as a stable tie-break.
 */
export async function listDrivers(ctx: AuthContext): Promise<ListDriversResult> {
  if (!canAssignDrivers(ctx.role)) return forbidden;

  const drivers = await getDb()
    .select({ id: user.id, name: user.name, email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, ctx.organizationId), eq(member.role, "driver")))
    .orderBy(asc(user.name), asc(user.id));

  return { ok: true, drivers };
}
