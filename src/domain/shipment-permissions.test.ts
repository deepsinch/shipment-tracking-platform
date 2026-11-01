import { describe, expect, it } from "vitest";

import { API_ROLE, ROLES, type ActorRole } from "./roles";
import {
  canAssignDrivers,
  canChangeDriver,
  canCreateShipments,
  canViewDeliveryPhoto,
  requiresDeliveryProof,
  canSetStatus,
  seesAllOrganizationShipments,
  statusOptionsFor,
} from "./shipment-permissions";
import { SHIPMENT_STATUSES } from "./shipment-status";

// Restated independently of the implementation, so an accidental change fails loudly.
const EXPECTED: Record<
  ActorRole,
  {
    create: boolean;
    assign: boolean;
    seesAll: boolean;
    cancel: boolean;
    proofRequired: boolean;
    viewsPhoto: boolean;
  }
> = {
  admin: {
    create: true,
    assign: true,
    seesAll: true,
    cancel: true,
    proofRequired: false,
    viewsPhoto: true,
  },
  dispatcher: {
    create: true,
    assign: true,
    seesAll: true,
    cancel: true,
    proofRequired: false,
    viewsPhoto: true,
  },
  driver: {
    create: false,
    assign: false,
    seesAll: false,
    cancel: false,
    proofRequired: true,
    viewsPhoto: false,
  },
  // An API key is a dispatcher without a person behind it (its scopes narrow it further).
  api: {
    create: true,
    assign: true,
    seesAll: true,
    cancel: true,
    proofRequired: false,
    viewsPhoto: false,
  },
};

describe("shipment permissions", () => {
  it.each([...ROLES, API_ROLE])("%s", (role) => {
    expect(canCreateShipments(role)).toBe(EXPECTED[role].create);
    expect(canAssignDrivers(role)).toBe(EXPECTED[role].assign);
    expect(seesAllOrganizationShipments(role)).toBe(EXPECTED[role].seesAll);
    expect(requiresDeliveryProof(role)).toBe(EXPECTED[role].proofRequired);
    expect(canViewDeliveryPhoto(role)).toBe(EXPECTED[role].viewsPhoto);
    for (const status of SHIPMENT_STATUSES) {
      expect(canSetStatus(role, status)).toBe(
        status === "cancelled" ? EXPECTED[role].cancel : true,
      );
    }
  });

  describe("statusOptionsFor", () => {
    it("offers dispatchers every transition the state machine allows", () => {
      expect(statusOptionsFor("dispatcher", "created")).toEqual([
        "picked_up",
        "exception",
        "cancelled",
      ]);
    });

    it("hides cancellation from drivers", () => {
      expect(statusOptionsFor("driver", "created")).toEqual(["picked_up", "exception"]);
      expect(statusOptionsFor("driver", "exception")).toEqual(["in_transit", "out_for_delivery"]);
    });

    it("offers nothing from a terminal status", () => {
      expect(statusOptionsFor("admin", "delivered")).toEqual([]);
    });
  });

  describe("canChangeDriver", () => {
    it("allows a new driver until the shipment is delivered or cancelled", () => {
      for (const status of SHIPMENT_STATUSES) {
        expect(canChangeDriver(status)).toBe(status !== "delivered" && status !== "cancelled");
      }
    });
  });
});
