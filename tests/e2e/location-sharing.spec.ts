import { expect, test } from "@playwright/test";

import { addDriver, createShipment, readPosition, signIn, signUp } from "./helpers";

const ANTWERP_RING = { latitude: 51.2194, longitude: 4.4025, accuracy: 15 };

test("a driver shares their location while the shipment is on the road", async ({
  page,
  browser,
}) => {
  const adminEmail = await signUp(page, "Lou Dispatcher");
  const trackingCode = await createShipment(page);
  const driverEmail = await addDriver(adminEmail, "Gus Driver");
  await page.reload();
  await page.getByLabel("Assigned driver").selectOption({ label: "Gus Driver" });
  await page.getByRole("button", { name: "Save driver" }).click();
  await expect(page.getByTestId("form-status")).toHaveText("Driver assigned.");

  // The driver's phone, with location permission granted and a fixed position.
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await phoneContext.grantPermissions(["geolocation"]);
  await phoneContext.setGeolocation(ANTWERP_RING);
  const phone = await phoneContext.newPage();
  await signIn(phone, driverEmail);
  await phone.getByRole("link", { name: new RegExp(trackingCode) }).click();
  await expect(phone.getByRole("heading", { name: trackingCode, level: 1 })).toBeVisible();

  // Nothing to share before pickup.
  await expect(phone.getByRole("heading", { name: "Location" })).toHaveCount(0);
  await phone.getByRole("button", { name: "Mark as picked up" }).click();
  await expect(phone.getByTestId("form-status")).toHaveText("Status changed to Picked up.");

  // Off until the driver switches it on.
  const toggle = phone.getByRole("switch", { name: /Share my location/ });
  await expect(toggle).not.toBeChecked();
  await expect(phone.getByTestId("location-status")).toHaveText("Not sharing your location.");
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(phone.getByTestId("location-status")).toContainText(/Sharing location · last sent/);
  // The status is announced as the switch's description.
  await expect(toggle).toHaveAccessibleDescription(/Sharing location · last sent/);

  expect(await readPosition(trackingCode)).toEqual({
    lat: ANTWERP_RING.latitude,
    lng: ANTWERP_RING.longitude,
    accuracyM: ANTWERP_RING.accuracy,
  });

  // Switching off stops sharing.
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(phone.getByTestId("location-status")).toHaveText("Not sharing your location.");

  // Once the shipment is no longer on the road, the control is gone.
  await toggle.click();
  await expect(phone.getByTestId("location-status")).toContainText("Sharing location");
  await phone.getByRole("button", { name: "Report a problem" }).click();
  await expect(phone.getByTestId("form-status")).toHaveText("Status changed to Exception.");
  await expect(phone.getByRole("heading", { name: "Location" })).toHaveCount(0);

  // The customer never sees coordinates.
  await phone.goto(`/track/${trackingCode}`);
  await expect(phone.getByRole("heading", { level: 1 })).toHaveText("Exception");
  await expect(phone.locator("body")).not.toContainText(String(ANTWERP_RING.latitude));

  await phoneContext.close();
});
