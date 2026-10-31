import { existsSync } from "node:fs";

import { config as loadEnv } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

// E2E_DATABASE_URL and BETTER_AUTH_SECRET come from .env (see .env.example).
loadEnv({ quiet: true });

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

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

/**
 * End-to-end tests against a production build. The web server command prepares a dedicated
 * database (created if missing, wiped, migrated), builds, and starts the app against it on its own
 * port, so a dev server on :3000 and the dev database are never touched.
 */
export default defineConfig({
  testDir: "tests/e2e",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { executablePath: chromiumPath },
      },
    },
  ],
  webServer: {
    command: `tsx tests/e2e/prepare-database.ts && next build && next start --port ${PORT}`,
    url: baseURL,
    // Always start fresh: a reused server could be pointing at another database.
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: "pipe",
    env: { DATABASE_URL: databaseUrl, BETTER_AUTH_URL: baseURL },
  },
});
