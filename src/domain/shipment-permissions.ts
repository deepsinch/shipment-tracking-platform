import type { ActorRole } from "./roles";
import { allowedNextStatuses, isTerminalStatus, type ShipmentStatus } from "./shipment-status";

/**
 * Shipment permissions by role. Pure rules, enforced by the services in `src/server/services/`
 * and used by the UI to offer only what the user may do.
 * See docs/architecture.md, "Shipment access".
 *
 * Phase 1 rules:
 * - Admins and dispatchers create shipments, assign drivers, and see and change every shipment in
 *   their organization.
 * - Drivers cannot create shipments; they see and change only shipments assigned to them, and
 *   cannot cancel a shipment (a commercial decision for the office, not the road).
 * - An API key (`api`) has a dispatcher's permissions, narrowed further by the key's scopes at the
 *   HTTP boundary. It cannot manage keys or the organization's members.
 */

export function canCreateShipments(role: ActorRole): boolean {
  return role === "admin" || role === "dispatcher" || role === "api";
}

/** Whether the role may assign drivers to shipments (and so list the organization's drivers). */
export function canAssignDrivers(role: ActorRole): boolean {
  return role === "admin" || role === "dispatcher" || role === "api";
}

/**
 * Whether a shipment in `status` may get a different driver. Not once it is delivered or
 * cancelled: the driver of a finished job is part of its record, and reassigning it would hand
 * the shipment's history to someone who never carried it.
 */
export function canChangeDriver(status: ShipmentStatus): boolean {
  return !isTerminalStatus(status);
}

/** True when the role sees every shipment in its organization, false when only assigned ones. */
export function seesAllOrganizationShipments(role: ActorRole): boolean {
  return role === "admin" || role === "dispatcher" || role === "api";
}

const DRIVER_FORBIDDEN_STATUSES: readonly ShipmentStatus[] = ["cancelled"];

/** Whether the role may move a shipment into `status` (independent of the state machine). */
export function canSetStatus(role: ActorRole, status: ShipmentStatus): boolean {
  return role !== "driver" || !DRIVER_FORBIDDEN_STATUSES.includes(status);
}

/** The next statuses to offer this role: allowed by the state machine and by the role. */
export function statusOptionsFor(role: ActorRole, from: ShipmentStatus): ShipmentStatus[] {
  return allowedNextStatuses(from).filter((status) => canSetStatus(role, status));
}
