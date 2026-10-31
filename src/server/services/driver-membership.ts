import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { member } from "@/server/db/schema";

/**
 * Shown for any driver id that may not be assigned: unknown users, other organizations' users and
 * members without the driver role all get the same message, so ids cannot be probed.
 */
export const NOT_AN_ORGANIZATION_DRIVER = "Choose a driver from your organization";

/**
 * Whether `userId` is a member of the organization with the `driver` role. Assigning anyone else
 * would show the shipment to someone outside the organization, or to a member without the
 * driver's view of it.
 */
export async function isDriverInOrganization(
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const [membership] = await getDb()
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
    .limit(1);
  return membership?.role === "driver";
}
