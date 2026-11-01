import { execFile } from "node:child_process";
import { randomInt } from "node:crypto";
import { promisify } from "node:util";

import type { Page } from "@playwright/test";

import { blockMapTiles, expect, test } from "./fixtures";
import { readPosition, recordCspViolations } from "./helpers";

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

test("the live map asks the server to move the trucks while it is open", async ({
  page,
  context,
}) => {
  // The demo's own parts (banner, buttons, the tick request) live under the same CSP.
  const violations = await recordCspViolations(context);
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
  expect(violations).toEqual([]);
});

test("the demo driver shares a simulated position and the browser's geolocation is never used", async ({
  browser,
  baseURL,
}) => {
  // The visitor's phone, in Delhi, with location permission granted: if the app asked for it at
  // all, it would get this position.
  const DELHI = { latitude: 28.6139, longitude: 77.209, accuracy: 5 };
  const phoneContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    baseURL,
    extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${randomInt(1, 255)}` },
  });
  await blockMapTiles(phoneContext);
  await phoneContext.grantPermissions(["geolocation"]);
  await phoneContext.setGeolocation(DELHI);
  // Any touch of navigator.geolocation (even reading the property) is recorded, and using it fails.
  await phoneContext.addInitScript(() => {
    const uses: string[] = [];
    Object.assign(window, { __geolocationUses: uses });
    const forbidden = (name: string) => () => {
      uses.push(name);
      throw new Error(`navigator.geolocation.${name} must not be used in demo mode`);
    };
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      get() {
        uses.push("get");
        return {
          getCurrentPosition: forbidden("getCurrentPosition"),
          watchPosition: forbidden("watchPosition"),
          clearWatch: forbidden("clearWatch"),
        };
      },
    });
  });
  const phone = await phoneContext.newPage();
  const violations = await recordCspViolations(phoneContext);

  await phone.goto("/sign-in");
  await phone
    .getByTestId("demo-sign-in")
    .getByRole("button", { name: /Sign in as driver/ })
    .click();
  await expect(phone).toHaveURL(/\/driver$/);
  await phone
    .getByRole("link")
    .filter({ hasText: /In transit|Out for delivery|Picked up/ })
    .first()
    .click();
  const heading = phone.getByRole("heading", { level: 1, name: /^WB-[0-9A-Z]{4}-[0-9A-Z]{4}$/ });
  await expect(heading).toBeVisible();
  const trackingCode = (await heading.textContent())!.trim();

  // The copy is there before anything is switched on.
  const note = phone.getByTestId("demo-location-note");
  await expect(note).toHaveText(
    "Demo: a simulated position along the route is shared. Your real location is never used.",
  );
  const toggle = phone.getByRole("switch", { name: /Share my location/ });
  await expect(toggle).not.toBeChecked();

  await toggle.click();
  await expect(toggle).toBeChecked();
  // A ping went through (the map's 12 s tick may have used the throttle window just before, in
  // which case the sharer sends again in the next one).
  await expect(phone.getByTestId("location-status")).toContainText(
    /Sharing simulated location · last sent/,
    { timeout: 25_000 },
  );

  // Stored: a position on the route, nowhere near the browser's.
  const stored = await readPosition(trackingCode, DEMO_DATABASE_URL);
  expect(stored).not.toBeNull();
  expect(stored!.accuracyM).toBe(10); // the simulator's, not the device's (5)
  expect(distanceKm(stored!, { lat: DELHI.latitude, lng: DELHI.longitude })).toBeGreaterThan(1000);

  // No permission prompt, no call, not even a look at the property; and the CSP is happy.
  expect(await geolocationUses(phone)).toEqual([]);
  expect(violations).toEqual([]);

  await toggle.click();
  await expect(toggle).not.toBeChecked();
  expect(await geolocationUses(phone)).toEqual([]);

  await phoneContext.close();
});

/** What the page's init script recorded: every touch of `navigator.geolocation`. */
const geolocationUses = (page: Page) =>
  page.evaluate(() => (window as unknown as { __geolocationUses: string[] }).__geolocationUses);

/** Great-circle distance in kilometres (haversine), enough to tell Delhi from the Benelux. */
function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

test("seeded deliveries show proof, with a labelled sample photo instead of any stored file", async ({
  page,
}) => {
  const violations = await recordCspViolations(page.context());
  await page.goto("/sign-in");
  await page
    .getByTestId("demo-sign-in")
    .getByRole("button", { name: /Sign in as admin/ })
    .click();
  await expect(page).toHaveURL(/\/dashboard\/shipments$/);

  // The drivers' deliveries were seeded with proof (some with a photo, some signed by name only);
  // the dispatcher's were marked from the office and have none.
  await page.goto("/dashboard/shipments?status=delivered");
  const links = page.getByRole("link", { name: /^WB-/ });
  await expect(links.first()).toBeVisible();
  const hrefs = await links.evaluateAll((links) => links.map((link) => link.getAttribute("href")!));
  expect(hrefs.length).toBeGreaterThan(0);

  let withSamplePhoto = 0;
  for (const href of hrefs) {
    await page.goto(href);
    const card = page.locator("[data-testid=proof-of-delivery]:visible");
    await expect(card).toBeVisible();
    if (await card.getByText("Sample photo. The public demo never stores photos.").isVisible()) {
      withSamplePhoto += 1;
      await expect(card.getByRole("img", { name: /sample delivery photo/ })).toBeVisible();
    }
  }
  expect(withSamplePhoto).toBeGreaterThan(0);
  expect(violations).toEqual([]);
});
