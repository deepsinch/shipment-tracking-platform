import { blockMapTiles, expect, test } from "./fixtures";
import {
  addDriver,
  createShipment,
  expectLive,
  recordCspViolations,
  signIn,
  signUp,
} from "./helpers";

const ANTWERP_RING = { latitude: 51.2194, longitude: 4.4025, accuracy: 15 };

/**
 * With map tiles blocked (the default), the map still fetches its style through the CSP and
 * starts its worker, so script, style, worker and connect violations are all caught. Run with
 * `E2E_MAP_TILES=live` to check real tiles, glyphs and sprites too.
 */
test("every surface runs under the Content-Security-Policy without a violation", async ({
  page,
  context,
  browser,
}) => {
  test.slow();
  const violations = await recordCspViolations(context);

  // Landing page: the headers are really sent (otherwise this spec would prove nothing).
  const landing = await page.goto("/");
  const headers = landing!.headers();
  expect(headers["content-security-policy"]).toContain("default-src 'self'");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toContain("geolocation=(self)");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  await page.goto("/sign-in");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  // Checked as early as possible too: a blocked script breaks the pages that follow, and the list
  // of violations says why far better than the timeout it would cause.
  expect(violations).toEqual([]);

  // Dashboard: sign-up lands on the list; booking opens the detail page.
  const adminEmail = await signUp(page, "Cora Dispatcher");
  await expectLive(page);
  const trackingCode = await createShipment(page);
  const driverEmail = await addDriver(adminEmail, "Dev Driver");
  await page.reload();
  await page.getByLabel("Assigned driver").selectOption({ label: "Dev Driver" });
  await page.getByRole("button", { name: "Save driver" }).click();
  await expect(page.getByTestId("form-status")).toHaveText("Driver assigned.");
  const detailUrl = page.url();

  // Driver app on a phone, sharing its location (geolocation is allowed for this origin).
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await blockMapTiles(phoneContext);
  const phoneViolations = await recordCspViolations(phoneContext);
  await phoneContext.grantPermissions(["geolocation"]);
  await phoneContext.setGeolocation(ANTWERP_RING);
  const phone = await phoneContext.newPage();
  await signIn(phone, driverEmail);
  await phone.getByRole("link", { name: new RegExp(trackingCode) }).click();
  await phone.getByRole("button", { name: "Mark as picked up" }).click();
  await expect(phone.getByTestId("form-status")).toHaveText("Status changed to Picked up.");
  await phone.getByRole("switch", { name: /Share my location/ }).click();
  await expect(phone.getByTestId("location-status")).toContainText(/Sharing location · last sent/);

  // Live map with the shipment's marker (MapLibre: style fetch, worker, live stream).
  // signUp's x-forwarded-for header (for the sign-up rate limit) would also go to the tile
  // server and turn every map request into a CORS preflight it refuses; it is not needed now.
  await context.setExtraHTTPHeaders({});
  await page.goto("/dashboard/map");
  await expect(
    page.getByRole("button", { name: `${trackingCode}, Picked up, to Antwerp` }),
  ).toBeVisible();
  await expectLive(page);
  if (process.env.E2E_MAP_TILES === "live") {
    // Give the basemap time to fetch tiles, glyphs and sprites.
    await page
      .waitForResponse((response) => /\.pbf(\?|$)/.test(response.url()), { timeout: 20_000 })
      .catch(() => {
        throw new Error(`No map tile loaded. CSP violations: ${JSON.stringify(violations)}`);
      });
    await page.waitForTimeout(2_000);
  }

  // The staff detail page (small route map, live "Last seen" line).
  await page.goto(detailUrl);
  await expect(page.getByRole("heading", { name: trackingCode, level: 1 })).toBeVisible();

  // Public tracking page, signed out.
  await phoneContext.clearCookies();
  await phone.goto(`/track/${trackingCode}`);
  await expect(phone.getByRole("heading", { level: 1 })).toHaveText("Picked up");

  expect(violations).toEqual([]);
  expect(phoneViolations).toEqual([]);
  await phoneContext.close();
});
