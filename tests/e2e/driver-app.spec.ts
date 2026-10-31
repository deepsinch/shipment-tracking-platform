import { expect, test } from "@playwright/test";

import { addDriver, createShipment, signIn, signUp, withoutLiveUpdates } from "./helpers";

test("a dispatcher assigns a driver, who advances the shipment from the driver app", async ({
  page,
  browser,
}) => {
  // The office: book a shipment and assign it to a new driver from the detail page.
  const adminEmail = await signUp(page, "Olly Dispatcher");
  const trackingCode = await createShipment(page);
  const driverEmail = await addDriver(adminEmail, "Dina Driver");
  await page.reload();

  await page.getByLabel("Assigned driver").selectOption({ label: "Dina Driver" });
  await page.getByRole("button", { name: "Save driver" }).click();
  await expect(page.getByTestId("form-status")).toHaveText("Driver assigned.");
  await expect(page.getByRole("list", { name: "Shipment history" })).toContainText(
    "Assigned to Dina Driver",
  );

  // The driver, on their own device: lands on the driver app, not the dashboard.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await signIn(phone, driverEmail);
  await expect(phone).toHaveURL(/\/driver$/);
  await expect(phone.getByRole("heading", { name: "My shipments", level: 1 })).toBeVisible();

  await phone.getByRole("link", { name: new RegExp(trackingCode) }).click();
  await expect(phone.getByRole("heading", { name: trackingCode, level: 1 })).toBeVisible();
  await expect(phone.getByRole("heading", { name: "Next stop: pickup" })).toBeVisible();

  await phone.getByLabel("Note for the customer (optional)").fill("Collected from the warehouse");
  await phone.getByRole("button", { name: "Mark as picked up" }).click();
  await expect(phone.getByTestId("form-status")).toHaveText("Status changed to Picked up.");
  // The page now offers the next steps, and points to the delivery.
  await expect(phone.getByRole("button", { name: "Mark as in transit" })).toBeVisible();
  await expect(phone.getByRole("button", { name: "Report a problem" })).toBeVisible();
  await expect(phone.getByRole("heading", { name: "Next stop: delivery" })).toBeVisible();

  // Drivers are kept out of the dashboard.
  await phone.goto("/dashboard/shipments");
  await expect(phone).toHaveURL(/\/driver$/);

  // The customer sees the driver's update, but not the internal reassignment or any names.
  await phone.goto(`/track/${trackingCode}`);
  await expect(phone.getByRole("heading", { level: 1 })).toHaveText("Picked up");
  const publicHistory = phone.getByRole("list", { name: "Shipment history" });
  await expect(publicHistory.getByRole("listitem")).toHaveCount(2);
  await expect(publicHistory).toContainText("Collected from the warehouse");
  const body = phone.locator("body");
  await expect(body).not.toContainText("Dina Driver");
  await expect(body).not.toContainText("Assigned");
});

test("staff who open the driver app are sent to the dashboard", async ({ page }) => {
  await signUp(page, "Stan Admin");

  await page.goto("/driver");

  await expect(page).toHaveURL(/\/dashboard\/shipments$/);
  await expect(page.getByRole("heading", { name: "Shipments", level: 1 })).toBeVisible();
});

test("a stale driver form reports the conflict and keeps the chosen driver", async ({
  page,
  context,
}) => {
  const adminEmail = await signUp(page, "Cleo Dispatcher");
  await createShipment(page);
  await addDriver(adminEmail, "Ari Driver");
  await addDriver(adminEmail, "Bea Driver");
  await page.reload();

  // Without live updates: otherwise it might refresh before the user submits.
  const staleTab = await context.newPage();
  await withoutLiveUpdates(staleTab);
  await staleTab.goto(page.url());
  await expect(staleTab.getByLabel("Assigned driver")).toBeVisible();

  await page.getByLabel("Assigned driver").selectOption({ label: "Ari Driver" });
  await page.getByRole("button", { name: "Save driver" }).click();
  await expect(page.getByTestId("form-status")).toHaveText("Driver assigned.");

  await staleTab.getByLabel("Assigned driver").selectOption({ label: "Bea Driver" });
  await staleTab.getByRole("button", { name: "Save driver" }).click();

  await expect(staleTab.getByTestId("form-alert")).toContainText(
    "Someone else updated this shipment",
  );
  await expect(staleTab.getByRole("list", { name: "Shipment history" })).toContainText(
    "Assigned to Ari Driver",
  );
  // The user's choice survives; retrying on the fresh version reassigns.
  await expect(staleTab.getByLabel("Assigned driver").locator("option:checked")).toHaveText(
    "Bea Driver",
  );
  await staleTab.getByRole("button", { name: "Save driver" }).click();
  await expect(staleTab.getByTestId("form-status")).toHaveText("Driver assigned.");
  await expect(staleTab.getByRole("list", { name: "Shipment history" })).toContainText(
    "Reassigned from Ari Driver to Bea Driver",
  );
});

test("marking a shipment delivered asks for confirmation, by touch or keyboard", async ({
  page,
  browser,
}) => {
  const adminEmail = await signUp(page, "Vic Dispatcher");
  const trackingCode = await createShipment(page);
  const driverEmail = await addDriver(adminEmail, "Rui Driver");
  await page.reload();
  await page.getByLabel("Assigned driver").selectOption({ label: "Rui Driver" });
  await page.getByRole("button", { name: "Save driver" }).click();
  await expect(page.getByTestId("form-status")).toHaveText("Driver assigned.");

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await signIn(phone, driverEmail);
  await phone.getByRole("link", { name: new RegExp(trackingCode) }).click();
  for (const [button, status] of [
    ["Mark as picked up", "Picked up"],
    ["Mark as in transit", "In transit"],
    ["Mark as out for delivery", "Out for delivery"],
  ] as const) {
    await phone.getByRole("button", { name: button }).click();
    await expect(phone.getByTestId("form-status")).toHaveText(`Status changed to ${status}.`);
  }

  // The first tap only asks. Backing out changes nothing.
  await phone.getByRole("button", { name: "Mark as delivered" }).click();
  const dialog = phone.getByRole("alertdialog", { name: `Mark ${trackingCode} as delivered?` });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription(/cannot be undone/);
  // Focus starts on the safe choice.
  await expect(dialog.getByRole("button", { name: "Not yet" })).toBeFocused();
  await dialog.getByRole("button", { name: "Not yet" }).click();
  await expect(dialog).toBeHidden();
  await expect(phone.getByTestId("form-status")).toHaveText("Status changed to Out for delivery.");

  // Escape closes it too.
  await phone.getByRole("button", { name: "Mark as delivered" }).click();
  await expect(dialog).toBeVisible();
  await phone.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // By keyboard: open, move to the confirm button, press Enter.
  await phone.getByRole("button", { name: "Mark as delivered" }).focus();
  await phone.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await phone.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Confirm delivery" })).toBeFocused();
  await phone.keyboard.press("Enter");
  await expect(phone.getByTestId("form-status")).toHaveText("Status changed to Delivered.");
  await expect(
    phone.getByText("This shipment is delivered. Nothing more to do here."),
  ).toBeVisible();
});
