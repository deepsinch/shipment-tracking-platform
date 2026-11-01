import { describe, expect, it } from "vitest";

import {
  appearsIn,
  countryToIso2,
  intakeAvailable,
  isoToDateTimeLocalUtc,
  normalizeServiceLevel,
  weightToKg,
} from "./intake";

describe("countryToIso2", () => {
  it.each([
    ["NL", "NL"],
    ["nl", "NL"],
    ["The Netherlands", "NL"],
    ["Niederlande", "NL"],
    ["Pays-Bas", "NL"],
    ["Belgique", "BE"],
    ["België", "BE"],
    ["Deutschland", "DE"],
    ["Österreich", "AT"],
    ["United Kingdom", "GB"],
    ["UK", "GB"],
    ["  france. ", "FR"],
    ["JP", "JP"],
  ])("%s is %s", (input, expected) => {
    expect(countryToIso2(input)).toBe(expected);
  });

  it.each(["Atlantis", "", "XX", "Netherlands Antilles of the North", null, undefined])(
    "does not guess for %s",
    (input) => {
      expect(countryToIso2(input)).toBe("");
    },
  );
});

describe("weightToKg", () => {
  it.each([
    ["12.5", "12.5"],
    ["12,5 kg", "12.5"],
    ["12.5 KG", "12.5"],
    ["2.5 tonnes", "2500"],
    ["1,5 t", "1500"],
    ["850 g", "0.85"],
    ["450 lbs", "204.12"],
    ["1.250,50 kg", "1250.5"],
    ["1,250.50 kg", "1250.5"],
    ["30 kilograms", "30"],
  ])("%s is %s kg", (input, expected) => {
    expect(weightToKg(input)).toBe(expected);
  });

  it.each(["", "heavy", "0", "-5 kg", "10 stone", "12 kg of books", "kg", null, undefined])(
    "refuses %s rather than guess",
    (input) => {
      expect(weightToKg(input)).toBe("");
    },
  );
});

describe("isoToDateTimeLocalUtc", () => {
  it.each([
    ["2026-11-12T14:00:00Z", "2026-11-12T14:00"],
    ["2026-11-12T14:00:00.000Z", "2026-11-12T14:00"],
    ["2026-11-20T09:30:00+01:00", "2026-11-20T08:30"],
    ["2026-11-20T09:30:00-0500", "2026-11-20T14:30"],
    ["2026-11-12T14:00", "2026-11-12T14:00"],
    ["2026-11-12", "2026-11-12T00:00"],
  ])("%s becomes %s UTC", (input, expected) => {
    expect(isoToDateTimeLocalUtc(input)).toBe(expected);
  });

  it.each(["next Friday", "12/11/2026", "2026-13-45T00:00:00Z", "", null])(
    "refuses %s",
    (input) => {
      expect(isoToDateTimeLocalUtc(input)).toBe("");
    },
  );
});

describe("normalizeServiceLevel", () => {
  it("accepts the three levels in any spelling and nothing else", () => {
    expect(normalizeServiceLevel("Same day")).toBe("same_day");
    expect(normalizeServiceLevel("same-day")).toBe("same_day");
    expect(normalizeServiceLevel("EXPRESS")).toBe("express");
    expect(normalizeServiceLevel("standard")).toBe("standard");
    expect(normalizeServiceLevel("overnight")).toBe("");
    expect(normalizeServiceLevel(null)).toBe("");
  });
});

describe("appearsIn", () => {
  const email = "Please deliver to 3072 AP Rotterdam. Ref: PO-48211. Mail grace@Example.test";

  it("finds values regardless of case, spaces and dashes", () => {
    expect(appearsIn("3072AP", email)).toBe(true);
    expect(appearsIn("po48211", email)).toBe(true);
    expect(appearsIn("grace@example.test", email)).toBe(true);
  });

  it("does not find what is not there", () => {
    expect(appearsIn("attacker@evil.example", email)).toBe(false);
    expect(appearsIn("", email)).toBe(false);
  });
});

describe("intakeAvailable", () => {
  it("needs a key or the test fake", () => {
    expect(intakeAvailable({ apiKey: "k", useFake: false })).toBe(true);
    expect(intakeAvailable({ apiKey: undefined, useFake: true })).toBe(true);
    expect(intakeAvailable({ apiKey: undefined, useFake: false })).toBe(false);
    expect(intakeAvailable({ apiKey: "", useFake: false })).toBe(false);
  });
});
