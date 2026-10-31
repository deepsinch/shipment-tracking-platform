import { describe, expect, it } from "vitest";

import {
  CROCKFORD_ALPHABET,
  generateTrackingCode,
  isCanonicalTrackingCode,
  normalizeTrackingCode,
} from "./tracking-code";

describe("generateTrackingCode", () => {
  it("produces the canonical WB-XXXX-XXXX format", () => {
    for (let i = 0; i < 1000; i++) {
      expect(isCanonicalTrackingCode(generateTrackingCode())).toBe(true);
    }
  });

  it("never uses the excluded letters I, L, O or U", () => {
    for (let i = 0; i < 1000; i++) {
      expect(generateTrackingCode().slice(3)).not.toMatch(/[ILOU]/);
    }
  });

  it("does not repeat across a large sample", () => {
    const codes = new Set(Array.from({ length: 10_000 }, generateTrackingCode));
    expect(codes.size).toBe(10_000);
  });

  it("uses every symbol of the alphabet", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      for (const char of generateTrackingCode().slice(3).replace("-", "")) seen.add(char);
    }
    expect(seen.size).toBe(CROCKFORD_ALPHABET.length);
  });
});

describe("normalizeTrackingCode", () => {
  it.each([
    ["WB-7K3M-Q9TX", "WB-7K3M-Q9TX"],
    ["wb-7k3m-q9tx", "WB-7K3M-Q9TX"],
    ["WB7K3MQ9TX", "WB-7K3M-Q9TX"],
    ["wb7k3mq9tx", "WB-7K3M-Q9TX"],
    ["  wb 7k3m q9tx ", "WB-7K3M-Q9TX"],
    ["WB-7K3MQ9TX", "WB-7K3M-Q9TX"],
  ])("normalizes %j to %s", (input, expected) => {
    expect(normalizeTrackingCode(input)).toBe(expected);
  });

  it("maps Crockford look-alikes I and L to 1 and O to 0", () => {
    expect(normalizeTrackingCode("wb-iloo-0000")).toBe("WB-1100-0000");
  });

  it.each([
    "",
    "WB",
    "WB-7K3M-Q9T",
    "WB-7K3M-Q9TXX",
    "7K3M-Q9TX",
    "XX-7K3M-Q9TX",
    "WB-7K3M-Q9TU",
    "WB-7K3M-Q9T!",
  ])("rejects %j", (input) => {
    expect(normalizeTrackingCode(input)).toBeNull();
  });

  it("round-trips generated codes", () => {
    const code = generateTrackingCode();
    expect(normalizeTrackingCode(code.toLowerCase().replace(/-/g, ""))).toBe(code);
  });
});
