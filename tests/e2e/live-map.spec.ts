import { blockMapTiles, expect, test } from "./fixtures";
import {
  addDriver,
  createShipment,
  expectLive,
  expectNotReloaded,
  markWindow,
  signIn,
  signUp,
} from "./helpers";

const ANTWERP_RING = { latitude: 51.2194, longitude: 4.4025, accuracy: 15 };
const BREDA = { latitude: 51.589, longitude: 4.776, accuracy: 15 };

test("the live map follows a driver's location and drops the shipment once delivered", async ({
  page,
  browser,
}) => {
  // Two pings are 10 s apart at the earliest (the server's throttle).
  test.slow();

  const adminEmail = await signUp(page, "Mia Dispatcher");
  const trackingCode = await createShipment(page);
  const driverEmail = await addDriver(adminEmail, "Ned Driver");
  await page.reload();
  await page.getByLabel("Assigned driver").selectOption({ label: "Ned Driver" });
  await page.getByRole("button", { name: "Save driver" }).click();
  await expect(page.getByTestId("form-status")).toHaveText("Driver assigned.");

  // The dispatcher opens the map from the list's view switch: nothing has a position yet.
  await page.goto("/dashboard/shipments");
  await page
    .getByRole("navigation", { name: "Shipment views" })
    .getByRole("link", { name: "Map" })
    .click();
  await expect(page.getByRole("heading", { name: "Live map", level: 1 })).toBeVisible();
  await expect(page).toHaveURL("/dashboard/map");
  await expect(page.getByTestId("fleet-count")).toHaveText("(0)");
  await expect(page.getByText("No shipment has shared a location yet.")).toBeVisible();
  await expectLive(page);
  await markWindow(page);

  // The driver picks the shipment up and shares their location.
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await blockMapTiles(phoneContext);
  await phoneContext.grantPermissions(["geolocation"]);
  await phoneContext.setGeolocation(ANTWERP_RING);
  const phone = await phoneContext.newPage();
  await signIn(phone, driverEmail);
  await phone.getByRole("link", { name: new RegExp(trackingCode) }).click();
  await expect(phone.getByRole("heading", { name: trackingCode, level: 1 })).toBeVisible();
  await phone.getByRole("button", { name: "Mark as picked up" }).click();
  await expect(phone.getByTestId("form-status")).toHaveText("Status changed to Picked up.");
  await phone.getByRole("switch", { name: /Share my location/ }).click();

  // Its first fix puts it on the map and in the list, without a reload.
  const marker = page.getByRole("button", { name: `${trackingCode}, Picked up, to Antwerp` });
  await expect(marker).toHaveAttribute("data-lat", String(ANTWERP_RING.latitude));
  await expect(marker).toHaveAttribute("data-lng", String(ANTWERP_RING.longitude));
  const entry = page.getByRole("list", { name: "Shipments on the map" }).getByRole("listitem");
  await expect(entry).toHaveCount(1);
  await expect(entry.getByRole("link", { name: trackingCode })).toHaveAttribute(
    "href",
    /^\/dashboard\/shipments\/[0-9a-f-]{36}$/,
  );
  await expect(entry).toContainText("To Antwerp, Belgium");
  await expect(entry).toContainText("near 51.2194, 4.4025");
  await expect(page.getByTestId("fleet-count")).toHaveText("(1)");

  // The truck moves: the marker and the list entry follow.
  await phoneContext.setGeolocation(BREDA);
  await expect(marker).toHaveAttribute("data-lat", String(BREDA.latitude), { timeout: 25_000 });
  await expect(marker).toHaveAttribute("data-lng", String(BREDA.longitude));
  await expect(entry).toContainText("near 51.5890, 4.7760");
  await expectNotReloaded(page);

  // Clicking the marker shows its popup; Escape closes it.
  await marker.click();
  const popup = page.getByTestId("map-popup");
  await expect(popup.getByRole("link", { name: trackingCode })).toBeVisible();
  await expect(popup).toContainText("Picked up");
  await expect(popup).toContainText("To Antwerp, Belgium");
  await expect(popup).toContainText(/Last seen (just now|\d+ s ago)/);
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);

  // The keyboard route: the list's button opens the same popup.
  await entry.getByRole("button", { name: `Show ${trackingCode} on the map` }).click();
  await expect(popup.getByRole("link", { name: trackingCode })).toBeVisible();

  // Delivered: the shipment leaves the map on the next refresh, still without a reload.
  for (const [button, status] of [
    ["Mark as in transit", "In transit"],
    ["Mark as out for delivery", "Out for delivery"],
  ] as const) {
    await phone.getByRole("button", { name: button }).click();
    await expect(phone.getByTestId("form-status")).toHaveText(`Status changed to ${status}.`);
  }
  await expect(
    page.getByRole("button", { name: new RegExp(`^${trackingCode}, Out for delivery`) }),
  ).toBeVisible();
  await phone.getByRole("button", { name: "Mark as delivered" }).click();
  await phone
    .getByRole("alertdialog", { name: `Mark ${trackingCode} as delivered?` })
    .getByRole("button", { name: "Confirm delivery" })
    .click();
  await expect(phone.getByTestId("form-status")).toHaveText("Status changed to Delivered.");

  await expect(page.getByTestId("map-marker")).toHaveCount(0);
  await expect(page.getByTestId("fleet-count")).toHaveText("(0)");
  await expect(popup).toHaveCount(0);
  await expectNotReloaded(page);

  await phoneContext.close();
});
