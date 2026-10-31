import { describe, expect, it } from "vitest";

import { SHIPMENT_STATUSES } from "@/domain/shipment-status";

import { statusMarkerColor, statusTone, TONE_MARKER_COLORS } from "./status-tone";

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

const contrastWithWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05);

describe("status tones", () => {
  it("groups statuses the way a dispatcher reads them", () => {
    expect(Object.fromEntries(SHIPMENT_STATUSES.map((status) => [status, statusTone(status)])))
      .toMatchInlineSnapshot(`
        {
          "cancelled": "off",
          "created": "waiting",
          "delivered": "done",
          "exception": "problem",
          "in_transit": "moving",
          "out_for_delivery": "arriving",
          "picked_up": "moving",
        }
      `);
  });

  it("gives every tone its own marker colour", () => {
    const colors = Object.values(TONE_MARKER_COLORS);
    expect(new Set(colors).size).toBe(colors.length);
    for (const color of colors) expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("colours statuses of one tone alike", () => {
    expect(statusMarkerColor("picked_up")).toBe(statusMarkerColor("in_transit"));
    expect(statusMarkerColor("exception")).not.toBe(statusMarkerColor("in_transit"));
  });

  it("keeps a white icon and outline readable on every marker (3:1 for graphics)", () => {
    for (const color of Object.values(TONE_MARKER_COLORS)) {
      expect(contrastWithWhite(color)).toBeGreaterThanOrEqual(3);
    }
  });
});
