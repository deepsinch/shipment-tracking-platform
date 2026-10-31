import { afterEach, describe, expect, it, vi } from "vitest";

describe("getDb", () => {
  afterEach(async () => {
    const { closeDb } = await import("./client");
    await closeDb();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("can be imported without DATABASE_URL and only fails when first used", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const { getDb } = await import("./client");
    expect(() => getDb()).toThrow(/DATABASE_URL is not set/);
  });

  it("returns the same client on every call", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://user:pass@localhost:5432/unused_test");
    const { getDb } = await import("./client");
    expect(getDb()).toBe(getDb());
  });
});
