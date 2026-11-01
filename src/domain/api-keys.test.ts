import { describe, expect, it } from "vitest";

import {
  API_KEY_PREFIX,
  bearerTokenOf,
  canManageApiKeys,
  displayPrefixOf,
  isApiScope,
  looksLikeApiKey,
} from "./api-keys";
import { API_ROLE, ROLES, isRole } from "./roles";

const KEY = `${API_KEY_PREFIX}${"A".repeat(43)}`;

describe("canManageApiKeys", () => {
  it("is for admins only", () => {
    expect([...ROLES, API_ROLE].filter(canManageApiKeys)).toEqual(["admin"]);
  });
});

describe("api role", () => {
  it("is not a member role", () => {
    expect(isRole(API_ROLE)).toBe(false);
    expect(ROLES).not.toContain(API_ROLE);
  });
});

describe("looksLikeApiKey", () => {
  it("accepts the generated shape only", () => {
    expect(looksLikeApiKey(KEY)).toBe(true);
    expect(looksLikeApiKey(`${KEY}x`)).toBe(false);
    expect(looksLikeApiKey(KEY.slice(0, -1))).toBe(false);
    expect(looksLikeApiKey(KEY.replace("wb_live_", "wb_test_"))).toBe(false);
    expect(looksLikeApiKey(`${KEY.slice(0, -1)}+`)).toBe(false);
    expect(looksLikeApiKey("")).toBe(false);
  });
});

describe("displayPrefixOf", () => {
  it("keeps the prefix and four characters of the secret", () => {
    expect(displayPrefixOf(`${API_KEY_PREFIX}AbCdEfGh`)).toBe("wb_live_AbCd");
  });
});

describe("bearerTokenOf", () => {
  it("reads a Bearer credential, case-insensitively", () => {
    expect(bearerTokenOf(`Bearer ${KEY}`)).toBe(KEY);
    expect(bearerTokenOf(`bearer ${KEY}`)).toBe(KEY);
  });

  it.each([null, "", "Bearer", `Basic ${KEY}`, `Bearer a b`, KEY])("rejects %j", (header) => {
    expect(bearerTokenOf(header)).toBeNull();
  });
});

describe("isApiScope", () => {
  it("knows the scopes", () => {
    expect(isApiScope("shipments:read")).toBe(true);
    expect(isApiScope("shipments:delete")).toBe(false);
    expect(isApiScope(undefined)).toBe(false);
  });
});
