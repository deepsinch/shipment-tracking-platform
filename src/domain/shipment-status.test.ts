import { describe, expect, it } from "vitest";

import {
  SHIPMENT_STATUSES,
  allowedNextStatuses,
  canTransition,
  isShipmentStatus,
  isTerminalStatus,
  shipmentStatusLabel,
  type ShipmentStatus,
} from "./shipment-status";

// The transition table from docs/architecture.md, restated independently so the test
// catches accidental edits to the implementation.
const ALLOWED: ReadonlyArray<[ShipmentStatus, ShipmentStatus]> = [
  ["created", "picked_up"],
  ["created", "exception"],
  ["created", "cancelled"],
  ["picked_up", "in_transit"],
  ["picked_up", "exception"],
  ["in_transit", "out_for_delivery"],
  ["in_transit", "exception"],
  ["out_for_delivery", "delivered"],
  ["out_for_delivery", "exception"],
  ["exception", "in_transit"],
  ["exception", "out_for_delivery"],
  ["exception", "cancelled"],
];

const isAllowed = (from: ShipmentStatus, to: ShipmentStatus) =>
  ALLOWED.some(([f, t]) => f === from && t === to);

describe("canTransition", () => {
  it.each(ALLOWED)("allows %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each<[ShipmentStatus, ShipmentStatus]>([
    ["created", "delivered"],
    ["created", "in_transit"],
    ["picked_up", "created"],
    ["picked_up", "cancelled"],
    ["in_transit", "picked_up"],
    ["in_transit", "delivered"],
    ["out_for_delivery", "cancelled"],
    ["exception", "delivered"],
    ["exception", "picked_up"],
    ["delivered", "exception"],
    ["cancelled", "created"],
  ])("rejects %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it("never allows a status to transition to itself", () => {
    for (const status of SHIPMENT_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it("matches the specified table for every pair of statuses", () => {
    for (const from of SHIPMENT_STATUSES) {
      for (const to of SHIPMENT_STATUSES) {
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(isAllowed(from, to));
      }
    }
  });
});

describe("allowedNextStatuses", () => {
  it("lists exactly the allowed targets for each status", () => {
    for (const from of SHIPMENT_STATUSES) {
      const expected = ALLOWED.filter(([f]) => f === from).map(([, t]) => t);
      expect([...allowedNextStatuses(from)].sort()).toEqual([...expected].sort());
    }
  });
});

describe("terminal statuses", () => {
  it.each<ShipmentStatus>(["delivered", "cancelled"])("%s is terminal", (status) => {
    expect(isTerminalStatus(status)).toBe(true);
    expect(allowedNextStatuses(status)).toHaveLength(0);
  });

  it("no other status is terminal", () => {
    const nonTerminal = SHIPMENT_STATUSES.filter((s) => s !== "delivered" && s !== "cancelled");
    for (const status of nonTerminal) {
      expect(isTerminalStatus(status)).toBe(false);
    }
  });
});

describe("isShipmentStatus", () => {
  it("accepts known statuses and rejects anything else", () => {
    expect(isShipmentStatus("in_transit")).toBe(true);
    expect(isShipmentStatus("IN_TRANSIT")).toBe(false);
    expect(isShipmentStatus("lost")).toBe(false);
    expect(isShipmentStatus(undefined)).toBe(false);
  });
});

describe("shipmentStatusLabel", () => {
  it("has a human label for every status", () => {
    for (const status of SHIPMENT_STATUSES) {
      expect(shipmentStatusLabel(status)).toMatch(/^[A-Z][a-z ]+$/);
    }
    expect(shipmentStatusLabel("out_for_delivery")).toBe("Out for delivery");
  });
});
