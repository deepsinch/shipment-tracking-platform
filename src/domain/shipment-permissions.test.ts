import { describe, expect, it } from "vitest";

import { API_ROLE, ROLES, type ActorRole } from "./roles";
import {
  canAssignDrivers,
  canChangeDriver,
  canCreateShipments,
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
  }
> = {
  admin: { create: true, assign: true, seesAll: true, cancel: true },
  dispatcher: { create: true, assign: true, seesAll: true, cancel: true },
  driver: { create: false, assign: false, seesAll: false, cancel: false },
  // An API key is a dispatcher without a person behind it (its scopes narrow it further).
  api: { create: true, assign: true, seesAll: true, cancel: true },
};

describe("shipment permissions", () => {
  it.each([...ROLES, API_ROLE])("%s", (role) => {
    expect(canCreateShipments(role)).toBe(EXPECTED[role].create);
    expect(canAssignDrivers(role)).toBe(EXPECTED[role].assign);
    expect(seesAllOrganizationShipments(role)).toBe(EXPECTED[role].seesAll);
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
