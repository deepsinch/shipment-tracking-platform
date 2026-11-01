import { existsSync } from "node:fs";

import { config as loadEnv } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

// E2E_DATABASE_URL and BETTER_AUTH_SECRET come from .env (see .env.example).
loadEnv({ quiet: true });

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;
// A second server of the same build with DEMO_MODE=true, for the specs about demo mode.
const DEMO_PORT = 3101;
const demoBaseURL = `http://localhost:${DEMO_PORT}`;

/**
 * This environment ships a preinstalled Chromium (never run `playwright install` here). Elsewhere,
 * PLAYWRIGHT_CHROMIUM points at a binary, or Playwright uses its own installed browser.
 */
const PREINSTALLED_CHROMIUM = "/opt/pw-browsers/chromium";
const chromiumPath =
  process.env.PLAYWRIGHT_CHROMIUM ??
  (existsSync(PREINSTALLED_CHROMIUM) ? PREINSTALLED_CHROMIUM : undefined);

const databaseUrl = process.env.E2E_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("E2E_DATABASE_URL is not set. Copy it from .env.example into .env.");
}

/** `waybill_e2e` becomes `waybill_demo_e2e`: its own database, wiped and seeded for demo mode. */
const demoDatabaseUrl = databaseUrl.replace(/_e2e(?=\?|$)/, "_demo_e2e");
if (demoDatabaseUrl === databaseUrl) {
  throw new Error("E2E_DATABASE_URL must end in _e2e (the demo server derives its own database).");
}

/**
 * End-to-end tests against a production build. The web server command prepares a dedicated
 * database (created if missing, wiped, migrated), builds, and starts the app against it on its own
 * port, so a dev server on :3000 and the dev database are never touched.
 */
export default defineConfig({
  testDir: "tests/e2e",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // In CI: annotations on the pull request, plus an HTML report uploaded when the job fails.
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /demo\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { executablePath: chromiumPath },
      },
    },
    {
      // Demo mode needs its own server (and database): it is a deployment setting, not a toggle.
      name: "demo",
      testMatch: /demo\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: demoBaseURL,
        launchOptions: { executablePath: chromiumPath },
      },
    },
  ],
  // Started in this order, each once the previous one answers: the second reuses the first's build.
  webServer: [
    {
      command: `tsx tests/e2e/prepare-database.ts && next build && next start --port ${PORT}`,
      url: baseURL,
      // Always start fresh: a reused server could be pointing at another database.
      reuseExistingServer: false,
      timeout: 300_000,
      stdout: "pipe",
      // The realtime listener must watch the same database (a DATABASE_DIRECT_URL in .env would
      // otherwise point it at the dev database and no live update would ever arrive). DEMO_MODE is
      // pinned off so a developer's .env cannot turn the demo on for the regular specs.
      env: {
        DATABASE_URL: databaseUrl,
        DATABASE_DIRECT_URL: databaseUrl,
        BETTER_AUTH_URL: baseURL,
        DEMO_MODE: "false",
      },
    },
    {
      command:
        "tsx tests/e2e/prepare-database.ts && " +
        "tsx --conditions=react-server scripts/seed.ts && " +
        `next start --port ${DEMO_PORT}`,
      url: demoBaseURL,
      reuseExistingServer: false,
      timeout: 300_000,
      stdout: "pipe",
      env: {
        DATABASE_URL: demoDatabaseUrl,
        DATABASE_DIRECT_URL: demoDatabaseUrl,
        BETTER_AUTH_URL: demoBaseURL,
        DEMO_MODE: "true",
        CRON_SECRET: "e2e-only-cron-secret-not-a-secret",
        DEMO_RESET_DATABASES: new URL(demoDatabaseUrl).pathname.slice(1),
      },
    },
  ],
});
