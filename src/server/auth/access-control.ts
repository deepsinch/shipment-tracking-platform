import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/organization/access";

import type { Role } from "@/domain/roles";

/**
 * Better Auth organization permissions (members, invitations, org settings).
 *
 * Only admins manage the organization. Shipment permissions are not modelled here: they are
 * domain rules enforced by the services, so Better Auth only owns membership and settings.
 */
export const ac = createAccessControl(defaultStatements);

export const roles = {
  admin: ac.newRole(adminAc.statements),
  dispatcher: ac.newRole({}),
  driver: ac.newRole({}),
} satisfies Record<Role, unknown>;
