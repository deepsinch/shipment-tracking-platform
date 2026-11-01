import { describe, expect, it } from "vitest";

import { buildPlan, describeDatabase } from "./build-plan";

describe("buildPlan", () => {
  it("migrates, then builds", () => {
    expect(
      buildPlan({ demo: { enabled: false, cronSecret: undefined, resetDatabases: [] } }),
    ).toEqual(["migrate", "build"]);
  });

  it("seeds the demo between the migrations and the build, only in demo mode", () => {
    expect(
      buildPlan({ demo: { enabled: true, cronSecret: "s", resetDatabases: ["neondb"] } }),
    ).toEqual(["migrate", "seed", "build"]);
  });
});

describe("describeDatabase", () => {
  it("keeps the host and database, never the credentials", () => {
    const described = describeDatabase(
      "postgresql://owner:hunter2@ep-cool-name.eu-central-1.aws.neon.tech/neondb?sslmode=require",
    );
    expect(described).toBe("ep-cool-name.eu-central-1.aws.neon.tech/neondb");
    expect(described).not.toContain("hunter2");
    expect(described).not.toContain("owner");
  });
});
