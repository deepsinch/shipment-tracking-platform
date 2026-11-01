import { describe, expect, it } from "vitest";

import { isCronAuthorized } from "./cron-auth";

const SECRET = "a-long-enough-cron-secret";

describe("isCronAuthorized", () => {
  it("accepts exactly `Bearer <secret>`", () => {
    expect(isCronAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it.each([
    ["a missing header", null],
    ["an empty header", ""],
    ["the bare secret", SECRET],
    ["another scheme", `Basic ${SECRET}`],
    ["a lowercase scheme", `bearer ${SECRET}`],
    ["a different secret of the same length", `Bearer ${"x".repeat(SECRET.length)}`],
    ["a prefix of the secret", `Bearer ${SECRET.slice(0, -1)}`],
    ["the secret plus a character", `Bearer ${SECRET}x`],
    ["the secret with surrounding space", ` Bearer ${SECRET} `],
  ])("rejects %s", (_name, header) => {
    expect(isCronAuthorized(header, SECRET)).toBe(false);
  });
});
