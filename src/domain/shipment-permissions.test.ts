import { describe, expect, it } from "vitest";

import { ROLES, type Role } from "./roles";
import { canCreateShipments, seesAllOrganizationShipments } from "./shipment-permissions";

// Restated independently of the implementation, so an accidental change fails loudly.
const EXPECTED: Record<Role, { create: boolean; seesAll: boolean }> = {
  admin: { create: true, seesAll: true },
  dispatcher: { create: true, seesAll: true },
  driver: { create: false, seesAll: false },
};

describe("shipment permissions", () => {
  it.each(ROLES)("%s", (role) => {
    expect(canCreateShipments(role)).toBe(EXPECTED[role].create);
    expect(seesAllOrganizationShipments(role)).toBe(EXPECTED[role].seesAll);
  });
});
