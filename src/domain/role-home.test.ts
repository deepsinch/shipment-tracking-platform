import { describe, expect, it } from "vitest";

import { homePathFor } from "./role-home";

describe("homePathFor", () => {
  it("sends staff to the dashboard", () => {
    expect(homePathFor("admin")).toBe("/dashboard");
    expect(homePathFor("dispatcher")).toBe("/dashboard");
  });

  it("sends drivers to the driver app", () => {
    expect(homePathFor("driver")).toBe("/driver");
  });
});
