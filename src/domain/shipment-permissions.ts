import type { Role } from "./roles";

/**
 * Shipment permissions by role. Pure rules, enforced by the services in `src/server/services/`.
 * See docs/architecture.md, "Users" and "Shipment access".
 *
 * Phase 1 rules:
 * - Admins and dispatchers create shipments and see and change every shipment in their organization.
 * - Drivers cannot create shipments; they see and change only shipments assigned to them.
 */

export function canCreateShipments(role: Role): boolean {
  return role === "admin" || role === "dispatcher";
}

/** True when the role sees every shipment in its organization, false when only assigned ones. */
export function seesAllOrganizationShipments(role: Role): boolean {
  return role === "admin" || role === "dispatcher";
}
