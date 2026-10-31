import { describe, expect, it } from "vitest";

import { ROLES, type Role } from "./roles";
import {
  canCreateShipments,
  canSetStatus,
  seesAllOrganizationShipments,
  statusOptionsFor,
} from "./shipment-permissions";
import { SHIPMENT_STATUSES } from "./shipment-status";

// Restated independently of the implementation, so an accidental change fails loudly.
const EXPECTED: Record<Role, { create: boolean; seesAll: boolean; cancel: boolean }> = {
  admin: { create: true, seesAll: true, cancel: true },
  dispatcher: { create: true, seesAll: true, cancel: true },
  driver: { create: false, seesAll: false, cancel: false },
};

describe("shipment permissions", () => {
  it.each(ROLES)("%s", (role) => {
    expect(canCreateShipments(role)).toBe(EXPECTED[role].create);
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
});
