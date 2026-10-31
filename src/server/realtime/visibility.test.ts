import { describe, expect, it } from "vitest";

import type { AuthContext } from "@/server/auth/auth-context";

import type { RealtimeMessage } from "./messages";
import { isVisibleTo, toClientEvent } from "./visibility";

const shipmentId = "6f1c1d5e-4a8b-4c3e-9f0a-1b2c3d4e5f60";

const changed = (overrides: Partial<RealtimeMessage> = {}): RealtimeMessage =>
  ({
    kind: "shipment_changed",
    organizationId: "org-a",
    shipmentId,
    assignedDriverId: "driver-1",
    previousDriverId: null,
    reason: "status",
    ...overrides,
  }) as RealtimeMessage;

const position = (overrides: Partial<RealtimeMessage> = {}): RealtimeMessage =>
  ({
    kind: "position",
    organizationId: "org-a",
    shipmentId,
    assignedDriverId: "driver-1",
    lat: 51.2,
    lng: 4.4,
    recordedAt: "2026-10-31T12:00:00.000Z",
    ...overrides,
  }) as RealtimeMessage;

const viewer = (role: AuthContext["role"], userId = `${role}-1`, organizationId = "org-a") => ({
  userId,
  organizationId,
  role,
});

describe("isVisibleTo", () => {
  it.each(["admin", "dispatcher", "driver"] as const)(
    "never shows another organization's messages to a %s",
    (role) => {
      const outsider = viewer(role, "driver-1", "org-b");
      expect(isVisibleTo(outsider, changed())).toBe(false);
      expect(isVisibleTo(outsider, position())).toBe(false);
      // Not even the "previous driver" path.
      expect(isVisibleTo(outsider, changed({ previousDriverId: "driver-1" }))).toBe(false);
    },
  );

  it.each(["admin", "dispatcher"] as const)(
    "shows a %s every message of their organization",
    (role) => {
      expect(isVisibleTo(viewer(role), changed({ assignedDriverId: null }))).toBe(true);
      expect(isVisibleTo(viewer(role), changed({ assignedDriverId: "someone-else" }))).toBe(true);
      expect(isVisibleTo(viewer(role), position())).toBe(true);
    },
  );

  it("shows a driver messages about shipments assigned to them", () => {
    const driver = viewer("driver", "driver-1");
    expect(isVisibleTo(driver, changed())).toBe(true);
    expect(isVisibleTo(driver, changed({ reason: "created" }))).toBe(true);
    expect(isVisibleTo(driver, position())).toBe(true);
  });

  it("hides other drivers' and unassigned shipments from a driver", () => {
    const driver = viewer("driver", "driver-2");
    expect(isVisibleTo(driver, changed())).toBe(false);
    expect(isVisibleTo(driver, changed({ assignedDriverId: null }))).toBe(false);
    expect(isVisibleTo(driver, position())).toBe(false);
  });

  it("shows the previous driver the change that took the shipment away", () => {
    const reassigned = changed({
      reason: "assignment",
      assignedDriverId: "driver-2",
      previousDriverId: "driver-1",
    });
    expect(isVisibleTo(viewer("driver", "driver-1"), reassigned)).toBe(true);
    expect(isVisibleTo(viewer("driver", "driver-2"), reassigned)).toBe(true);
    expect(isVisibleTo(viewer("driver", "driver-3"), reassigned)).toBe(false);

    const unassigned = changed({
      reason: "assignment",
      assignedDriverId: null,
      previousDriverId: "driver-1",
    });
    expect(isVisibleTo(viewer("driver", "driver-1"), unassigned)).toBe(true);
  });
});

describe("toClientEvent", () => {
  it("sends a shipment change without organization or user ids", () => {
    expect(toClientEvent(changed({ previousDriverId: "driver-0" }))).toEqual({
      kind: "shipment_changed",
      shipmentId,
      reason: "status",
    });
  });

  it("sends a position without organization or user ids", () => {
    expect(toClientEvent(position())).toEqual({
      kind: "position",
      shipmentId,
      lat: 51.2,
      lng: 4.4,
      recordedAt: "2026-10-31T12:00:00.000Z",
    });
  });
});
