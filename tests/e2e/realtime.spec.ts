import { expect, test, type Page } from "@playwright/test";

import { addDriver, createShipment, expectLive, signIn, signUp } from "./helpers";

const ANTWERP_RING = { latitude: 51.2194, longitude: 4.4025, accuracy: 15 };

/**
 * Marks the page's window. The mark survives client-side re-renders (`router.refresh()`) but not
 * a reload, so `expectNotReloaded` proves an update arrived live.
 */
async function markWindow(page: Page) {
  await page.evaluate(() => Object.assign(window, { __waybillNotReloaded: true }));
}
async function expectNotReloaded(page: Page) {
  expect(await page.evaluate(() => "__waybillNotReloaded" in window)).toBe(true);
}

test("the dispatcher's detail page follows the driver's updates without a reload", async ({
  page,
  browser,
}) => {
  // The office books a shipment and assigns a driver, then stays on the detail page.
  const adminEmail = await signUp(page, "Rhea Dispatcher");
  const trackingCode = await createShipment(page);
  const driverEmail = await addDriver(adminEmail, "Theo Driver");
  await page.reload();
  await page.getByLabel("Assigned driver").selectOption({ label: "Theo Driver" });
  await page.getByRole("button", { name: "Save driver" }).click();
  await expect(page.getByTestId("form-status")).toHaveText("Driver assigned.");
  await expectLive(page);
  await expect(page.getByTestId("last-seen")).toHaveText("No location shared yet");
  await markWindow(page);

  // The driver, on their own phone with location permission.
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await phoneContext.grantPermissions(["geolocation"]);
  await phoneContext.setGeolocation(ANTWERP_RING);
  const phone = await phoneContext.newPage();
  await signIn(phone, driverEmail);
  await phone.getByRole("link", { name: new RegExp(trackingCode) }).click();
  await expect(phone.getByRole("heading", { name: trackingCode, level: 1 })).toBeVisible();
  await expectLive(phone);

  // A status change on the phone reaches the office's page: badge, history and status form.
  await phone.getByRole("button", { name: "Mark as picked up" }).click();
  await expect(phone.getByTestId("form-status")).toHaveText("Status changed to Picked up.");

  const history = page.getByRole("list", { name: "Shipment history" });
  await expect(history).toContainText("Picked up");
  await expect(page.getByLabel("New status").getByRole("option")).toHaveText([
    "Choose a status",
    "In transit",
    "Exception",
  ]);

  // Sharing the location moves the "Last seen" line in place.
  await phone.getByRole("switch", { name: /Share my location/ }).click();
  await expect(page.getByTestId("last-seen")).toContainText("near 51.2194, 4.4025");
  await expect(page.getByTestId("last-seen")).toContainText("UTC");
  await expectNotReloaded(page);

  // While the dispatcher is typing, a refresh would wipe the form: it waits and says so.
  await page.getByLabel("Internal note (optional)").fill("Call before arrival");
  await phone.getByRole("button", { name: "Mark as in transit" }).click();
  await expect(phone.getByTestId("form-status")).toHaveText("Status changed to In transit.");

  const notice = page.getByText("This shipment was updated while you were editing.");
  await expect(notice).toBeVisible();
  await expect(page.getByLabel("Internal note (optional)")).toHaveValue("Call before arrival");
  await expect(history).not.toContainText("In transit");

  // Asking for the latest data shows it, on a fresh form.
  await page.getByRole("button", { name: "Show latest" }).click();
  await expect(history).toContainText("In transit");
  await expect(notice).toBeHidden();
  await expect(page.getByLabel("Internal note (optional)")).toHaveValue("");
  await expectNotReloaded(page);

  await phoneContext.close();
});

test("the shipment list shows a booking made in another tab without a reload", async ({
  page,
  context,
}) => {
  await signUp(page, "Lena Dispatcher");
  await expectLive(page);
  await markWindow(page);

  const otherTab = await context.newPage();
  await otherTab.goto("/dashboard/shipments");
  const trackingCode = await createShipment(otherTab);

  await expect(page.getByRole("link", { name: trackingCode })).toBeVisible();
  await expectNotReloaded(page);
});

test("a driver's list gains and loses shipments as dispatch reassigns them", async ({
  page,
  browser,
}) => {
  const adminEmail = await signUp(page, "Omar Dispatcher");
  const trackingCode = await createShipment(page);
  const firstDriver = await addDriver(adminEmail, "Fay Driver");
  await addDriver(adminEmail, "Gil Driver");
  await page.reload();

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await signIn(phone, firstDriver);
  await expect(phone.getByRole("heading", { name: "My shipments", level: 1 })).toBeVisible();
  await expectLive(phone);
  await markWindow(phone);
  const card = phone.getByRole("link", { name: new RegExp(trackingCode) });
  await expect(card).toHaveCount(0);

  await page.getByLabel("Assigned driver").selectOption({ label: "Fay Driver" });
  await page.getByRole("button", { name: "Save driver" }).click();
  await expect(card).toBeVisible();

  // Moved to another driver: it leaves Fay's list.
  await page.getByLabel("Assigned driver").selectOption({ label: "Gil Driver" });
  await page.getByRole("button", { name: "Save driver" }).click();
  await expect(card).toHaveCount(0);
  await expectNotReloaded(phone);
});
