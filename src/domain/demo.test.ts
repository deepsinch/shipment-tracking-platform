import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEMO_RESET_CRON,
  DEMO_RESET_LABEL,
  DEMO_RESET_PATH,
  DEMO_TICK_INTERVAL_MS,
  DEMO_TICK_PATH,
} from "./demo";

describe("vercel.json", () => {
  const config = JSON.parse(readFileSync(path.resolve(process.cwd(), "vercel.json"), "utf8")) as {
    buildCommand?: string;
    crons?: { path: string; schedule: string }[];
  };

  it("schedules the nightly reset at the time the banner announces", () => {
    expect(config.crons).toContainEqual({ path: DEMO_RESET_PATH, schedule: DEMO_RESET_CRON });
  });

  it("schedules the daily purge at a different hour from the reset", () => {
    const purge = config.crons?.find((cron) => cron.path === "/api/cron/purge");
    expect(purge?.schedule).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
    expect(purge?.schedule.split(" ")[1]).not.toBe(DEMO_RESET_CRON.split(" ")[1]);
  });

  it("stays within the Hobby plan: every job at most once a day", () => {
    // minute hour day-of-month month day-of-week: fixed minute and hour, every day.
    for (const cron of config.crons ?? []) {
      expect(cron.schedule).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
    }
  });

  it("builds with the deploy script, not plain next build", () => {
    expect(config.buildCommand).toBe("pnpm run vercel-build");
    const pkg = JSON.parse(readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["vercel-build"]).toBeDefined();
  });
});

describe("demo constants", () => {
  it("labels the reset time in UTC with two digits", () => {
    expect(DEMO_RESET_LABEL).toBe("03:00 UTC");
  });

  it("ticks no faster than the ping throttle allows", () => {
    expect(DEMO_TICK_INTERVAL_MS).toBeGreaterThan(10_000);
    expect(DEMO_TICK_PATH).toBe("/api/demo/tick");
  });
});
