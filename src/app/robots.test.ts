import { describe, expect, it } from "vitest";

import robots from "./robots";

describe("robots.txt", () => {
  it("keeps crawlers out of every app surface and leaves the landing page indexable", () => {
    expect(robots().rules).toEqual({
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/driver", "/track", "/api", "/sign-in", "/sign-up"],
    });
  });
});
