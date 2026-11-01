import { describe, expect, it } from "vitest";

import { MAP_STYLE_URL } from "@/components/map/map-config";

import { contentSecurityPolicy, MAP_TILE_ORIGIN, securityHeaders } from "./security-headers";

/** "script-src 'self' x; img-src y" -> { "script-src": ["'self'", "x"], "img-src": ["y"] } */
function parse(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy.split("; ").map((directive) => {
      const [name, ...sources] = directive.split(" ");
      return [name, sources];
    }),
  );
}

describe("contentSecurityPolicy", () => {
  const production = parse(contentSecurityPolicy({ dev: false }));

  it("never allows eval in production, only in development", () => {
    expect(production["script-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    expect(parse(contentSecurityPolicy({ dev: true }))["script-src"]).toContain("'unsafe-eval'");
  });

  it("lets the map reach the tile server it is configured with, and nothing else external", () => {
    expect(MAP_TILE_ORIGIN).toBe(new URL(MAP_STYLE_URL).origin);
    expect(production["connect-src"]).toEqual(["'self'", "https://tiles.openfreemap.org"]);
    expect(production["worker-src"]).toEqual(["'self'"]);
    for (const directive of ["script-src", "style-src", "img-src", "font-src", "default-src"]) {
      expect((production[directive] ?? []).filter((source) => source.startsWith("http"))).toEqual(
        [],
      );
    }
  });

  it("locks down plugins, base URLs, form targets and framing", () => {
    expect(production["object-src"]).toEqual(["'none'"]);
    expect(production["base-uri"]).toEqual(["'self'"]);
    expect(production["form-action"]).toEqual(["'self'"]);
    expect(production["frame-ancestors"]).toEqual(["'none'"]);
  });
});

describe("securityHeaders", () => {
  it("sets the full header set", () => {
    const headers = Object.fromEntries(
      securityHeaders({ dev: false }).map(({ key, value }) => [key, value]),
    );
    expect(Object.keys(headers).sort()).toEqual([
      "Content-Security-Policy",
      "Permissions-Policy",
      "Referrer-Policy",
      "X-Content-Type-Options",
      "X-Frame-Options",
    ]);
    expect(headers["Permissions-Policy"]).toContain("geolocation=(self)");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
    expect(headers["Permissions-Policy"]).toContain("microphone=()");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  });
});
