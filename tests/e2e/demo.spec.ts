import { execFile } from "node:child_process";
import { randomInt } from "node:crypto";
import { promisify } from "node:util";

import { expect, test } from "./fixtures";

/**
 * Demo mode (`DEMO_MODE=true`), served by the second web server of playwright.config.ts (project
 * "demo": its own database, seeded with Demo Freight Co). The regular specs run with demo mode
 * off, and `demo-off.spec.ts` proves nothing of this appears there.
 */

/** The database of the demo server (see playwright.config.ts). */
const DEMO_DATABASE_URL = process.env.E2E_DATABASE_URL!.replace(/_e2e(?=\?|$)/, "_demo_e2e");

test.beforeEach(async ({ context }) => {
  // Its own client address, so the specs' sign-ins never share a rate-limit bucket.
  await context.setExtraHTTPHeaders({ "x-forwarded-for": `203.0.113.${randomInt(1, 255)}` });
});

test("a banner says the demo resets nightly, and is dismissed for the browser session", async ({
  page,
  context,
}) => {
  await page.goto("/sign-in");
  const banner = page.getByRole("region", { name: "Demo notice" });
  await expect(banner).toContainText("Demo");
  await expect(banner).toContainText("data resets nightly around 03:00 UTC");

  // On other pages too, not only sign-in.
  await page.goto("/");
  await expect(banner).toBeVisible();

  await banner.getByRole("button", { name: "Dismiss demo notice" }).click();
  await expect(banner).toBeHidden();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Shipment tracking and dispatch" })).toBeVisible();
  await expect(banner).toBeHidden();

  // A new tab is a new browser session: the notice is back.
  const other = await context.newPage();
  await other.goto("/sign-in");
  await expect(other.getByRole("region", { name: "Demo notice" })).toBeVisible();
});

test("one click signs in as each demo account, each landing where its role belongs", async ({
  page,
}) => {
  const demo = page.getByTestId("demo-sign-in");

  await page.goto("/sign-in");
  await expect(demo.getByRole("heading", { name: "Try the demo" })).toBeVisible();
  await expect(demo.getByRole("button")).toHaveCount(3);
  // Credentials are never printed on the page.
  await expect(page.getByText("demo-password")).toHaveCount(0);

  await demo.getByRole("button", { name: /Sign in as dispatcher/ }).click();
  await expect(page).toHaveURL(/\/dashboard\/shipments$/);
  await expect(page.getByRole("heading", { name: "Shipments", level: 1 })).toBeVisible();
  await expect(page.getByText("Dana Dispatcher · Dispatcher")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();

  await expect(page).toHaveURL(/\/sign-in$/);
  await demo.getByRole("button", { name: /Sign in as driver/ }).click();
  await expect(page).toHaveURL(/\/driver$/);
  await expect(page.getByRole("heading", { name: "My shipments", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();

  await expect(page).toHaveURL(/\/sign-in$/);
  await demo.getByRole("button", { name: /Sign in as admin/ }).click();
  await expect(page).toHaveURL(/\/dashboard\/shipments$/);
  await expect(page.getByText("Alex Admin · Admin")).toBeVisible();
});

test("the one-click sign-in is rate limited like any other sign-in", async ({ page }) => {
  // The client address has used up its sign-in allowance (30 per 15 minutes, counted before any
  // password is checked): the buttons get no way around it.
  const clientIp = `198.51.100.${randomInt(1, 255)}`;
  await promisify(execFile)(
    "pnpm",
    ["exec", "tsx", "--conditions=react-server", "tests/e2e/exhaust-sign-in-limit.ts", clientIp],
    { env: { ...process.env, DATABASE_URL: DEMO_DATABASE_URL } },
  );
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": clientIp });

  await page.goto("/sign-in");
  await page
    .getByTestId("demo-sign-in")
    .getByRole("button", { name: /Sign in as dispatcher/ })
    .click();

  await expect(page.getByTestId("form-alert")).toContainText("Too many attempts");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("the live map asks the server to move the trucks while it is open", async ({ page }) => {
  await page.goto("/sign-in");
  await page
    .getByTestId("demo-sign-in")
    .getByRole("button", { name: /Sign in as dispatcher/ })
    .click();
  await expect(page).toHaveURL(/\/dashboard\/shipments$/);

  const tick = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/demo/tick") && response.request().method() === "POST",
  );
  await page.goto("/dashboard/map");
  await expect(page.getByRole("heading", { name: "Live map", level: 1 })).toBeVisible();

  // First viewer on a fresh demo database: nothing has ticked yet, so this one runs.
  const response = await tick;
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ ran: true });
});
