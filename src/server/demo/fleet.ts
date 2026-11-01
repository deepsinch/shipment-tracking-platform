import "server-only";

import { eq } from "drizzle-orm";

import { DEMO_ORGANIZATION_NAME, DEMO_USERS } from "@/domain/demo";
import { resolveAuthContext, type AuthContext } from "@/server/auth/auth-context";
import { getDb } from "@/server/db/client";
import { member, user } from "@/server/db/schema";
import { listDrivers } from "@/server/services/list-drivers";

/**
 * The demo organization and its drivers. The demo organization is the one the seeded demo admin
 * belongs to, found by that account's email, not by the organization's name: anyone may sign up
 * and call their company "Demo Freight Co" on a public demo, and must not get the demo's
 * simulator. Looked up on every call, never cached: the nightly reset recreates every id.
 */

type AdminMembership = { userId: string; organizationId: string };

async function findDemoAdmin(): Promise<AdminMembership | null> {
  const [row] = await getDb()
    .select({ userId: user.id, organizationId: member.organizationId })
    .from(user)
    .innerJoin(member, eq(member.userId, user.id))
    .where(eq(user.email, DEMO_USERS[0].email))
    .limit(1);
  return row ?? null;
}

/** The demo organization's id, or null when the demo has not been seeded. */
export async function findDemoOrganizationId(): Promise<string | null> {
  return (await findDemoAdmin())?.organizationId ?? null;
}

/** The demo organization's drivers, each as the AuthContext a session would give them. */
export async function resolveDemoDrivers(): Promise<AuthContext[]> {
  const admin = await findDemoAdmin();
  if (!admin) {
    throw new Error(`${DEMO_ORGANIZATION_NAME} is not seeded yet. Run \`pnpm db:seed\` first.`);
  }
  const adminContext = await resolveAuthContext({
    userId: admin.userId,
    activeOrganizationId: admin.organizationId,
  });
  if (!adminContext) {
    throw new Error(`${DEMO_USERS[0].email} is no longer a member of ${DEMO_ORGANIZATION_NAME}.`);
  }
  const drivers = await listDrivers(adminContext);
  if (!drivers.ok) throw new Error(`${DEMO_USERS[0].email} may not list drivers.`);

  const contexts = await Promise.all(
    drivers.drivers.map((driver) =>
      resolveAuthContext({ userId: driver.id, activeOrganizationId: admin.organizationId }),
    ),
  );
  return contexts.filter((context) => context !== null);
}
