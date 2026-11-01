import { and, eq } from "drizzle-orm";

import { isRole, type ActorRole, type Role } from "@/domain/roles";
import { getDb } from "@/server/db/client";
import { member } from "@/server/db/schema";

/**
 * Who is acting, in which organization, with which role. Every service takes one.
 * It is always derived from the server-side session, never from client input.
 */
export type AuthContext = {
  userId: string;
  organizationId: string;
  role: ActorRole;
};

/**
 * The context of a signed-in member: `role` is a real member role (never `api`), which is what
 * pages need to pick a home or a label. Assignable to `AuthContext`, so services accept it.
 */
export type MemberAuthContext = AuthContext & { role: Role };

/**
 * Builds the AuthContext for a session. The role is read from the membership row on every
 * request (not cached in the session), so role changes and removals take effect immediately.
 * Returns null when there is no active organization or the user is no longer a member of it.
 */
export async function resolveAuthContext(session: {
  userId: string;
  activeOrganizationId?: string | null;
}): Promise<MemberAuthContext | null> {
  const organizationId = session.activeOrganizationId;
  if (!organizationId) return null;

  const [membership] = await getDb()
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, session.userId), eq(member.organizationId, organizationId)))
    .limit(1);
  if (!membership || !isRole(membership.role)) return null;

  return { userId: session.userId, organizationId, role: membership.role };
}
