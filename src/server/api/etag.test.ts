import { describe, expect, it } from "vitest";

import { etagOf, parseIfMatch } from "./etag";

describe("etag", () => {
  it("round-trips a version", () => {
    expect(etagOf(7)).toBe('"7"');
    expect(parseIfMatch(etagOf(7))).toEqual({ kind: "version", version: 7 });
  });

  it("distinguishes a missing header from a malformed one", () => {
    expect(parseIfMatch(null)).toEqual({ kind: "missing" });
    for (const bad of ["", "3", 'W/"3"', '"3", "4"', "*", '"0"', '"-1"', '"abc"', '"1234567890"']) {
      expect(parseIfMatch(bad)).toEqual({ kind: "malformed" });
    }
  });
});
