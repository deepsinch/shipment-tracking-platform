import { describe, expect, it } from "vitest";

import { formatCountry, formatDateTime, formatElapsed, formatPlace, formatWeight } from "./format";

describe("format", () => {
  it("shows date-times in UTC with a label", () => {
    expect(formatDateTime(new Date("2026-11-02T14:30:00Z"))).toBe("2 Nov 2026, 14:30 UTC");
  });

  it("names countries and places", () => {
    expect(formatCountry("NL")).toBe("Netherlands");
    expect(formatPlace("Antwerp", "BE")).toBe("Antwerp, Belgium");
    // Not a region code: shown as given rather than throwing.
    expect(formatCountry("1")).toBe("1");
  });

  it("formats weights in kg", () => {
    expect(formatWeight(12.5)).toBe("12.5 kg");
    expect(formatWeight(1250)).toBe("1,250 kg");
  });

  it("says how long ago something happened", () => {
    expect(formatElapsed(0)).toBe("just now");
    expect(formatElapsed(4_999)).toBe("just now");
    expect(formatElapsed(12_400)).toBe("12 s ago");
    expect(formatElapsed(59_999)).toBe("59 s ago");
    expect(formatElapsed(185_000)).toBe("3 min ago");
    // A slightly fast client clock never shows a negative time.
    expect(formatElapsed(-2_000)).toBe("just now");
  });
});
