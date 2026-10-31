import { expect, test } from "./fixtures";

import { changeStatus, createShipment, signUp, withoutLiveUpdates } from "./helpers";

test("a dispatcher books and advances a shipment; the customer sees only public details", async ({
  page,
}) => {
  await signUp(page);
  const trackingCode = await createShipment(page);

  await changeStatus(page, "Picked up", {
    city: "Rotterdam",
    publicNote: "Collected from the warehouse",
    internalNote: "Gate code 4411",
  });
  await expect(page.getByTestId("form-status")).toHaveText("Status changed to Picked up.");

  await changeStatus(page, "In transit", {
    publicNote: "On the way to Antwerp",
    internalNote: "Swapped trucks in Breda",
  });
  await expect(page.getByTestId("form-status")).toHaveText("Status changed to In transit.");

  // Staff see the whole history, internal notes and who made each change.
  const history = page.getByRole("list", { name: "Shipment history" });
  await expect(history.getByRole("listitem")).toHaveCount(3);
  await expect(history).toContainText("Gate code 4411");
  await expect(history).toContainText("by Erin Dispatcher");

  const popupOpened = page.waitForEvent("popup");
  await page.getByRole("link", { name: /Public tracking page/ }).click();
  const tracking = await popupOpened;

  await expect(tracking).toHaveURL(new RegExp(`/track/${trackingCode}$`));
  await expect(tracking.getByRole("heading", { level: 1 })).toHaveText("In transit");
  await expect(tracking.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

  const publicHistory = tracking.getByRole("list", { name: "Shipment history" });
  await expect(publicHistory.getByRole("listitem")).toHaveCount(3);
  await expect(publicHistory).toContainText("Collected from the warehouse");
  await expect(publicHistory).toContainText("On the way to Antwerp");
  await expect(publicHistory).toContainText("Rotterdam");

  // Never public: internal notes and staff names.
  const pageText = tracking.locator("body");
  await expect(pageText).not.toContainText("Gate code 4411");
  await expect(pageText).not.toContainText("Swapped trucks in Breda");
  await expect(pageText).not.toContainText("Erin Dispatcher");
});

test("a stale status form reports the conflict, shows fresh data and can be retried", async ({
  page,
  context,
}) => {
  await signUp(page, "Sam Dispatcher");
  await createShipment(page);

  // A second tab opened on the same shipment, which goes stale once the first tab changes it.
  // Without live updates: otherwise it might refresh before the user submits.
  const staleTab = await context.newPage();
  await withoutLiveUpdates(staleTab);
  await staleTab.goto(page.url());
  await expect(staleTab.getByLabel("New status")).toBeVisible();

  await changeStatus(page, "Picked up");
  await expect(page.getByTestId("form-status")).toHaveText("Status changed to Picked up.");

  await changeStatus(staleTab, "Exception", { publicNote: "Address unclear" });

  const alert = staleTab.getByTestId("form-alert");
  await expect(alert).toContainText("Someone else updated this shipment");
  await expect(alert).toContainText("It is now Picked up.");
  // Fresh data: the other tab's change is in the history, and the form offers the new options.
  await expect(staleTab.getByRole("list", { name: "Shipment history" })).toContainText("Picked up");
  await expect(staleTab.getByLabel("New status").getByRole("option")).toHaveText([
    "Choose a status",
    "In transit",
    "Exception",
  ]);
  // What the user typed survives, so retrying is one click.
  await expect(staleTab.getByLabel("Note for the customer (optional)")).toHaveValue(
    "Address unclear",
  );

  await staleTab.getByRole("button", { name: "Update status" }).click();
  await expect(staleTab.getByTestId("form-status")).toHaveText("Status changed to Exception.");
});

test("cancelling a shipment asks for confirmation first", async ({ page }) => {
  await signUp(page, "Kit Dispatcher");
  const trackingCode = await createShipment(page);

  await changeStatus(page, "Cancelled", { internalNote: "Customer called to cancel" });
  const dialog = page.getByRole("alertdialog", { name: `Cancel ${trackingCode}?` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Keep shipment" })).toBeFocused();

  // Keeping it changes nothing, and what was typed is still there.
  await dialog.getByRole("button", { name: "Keep shipment" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("form-status")).toHaveCount(0);
  await expect(
    page.getByRole("list", { name: "Shipment history" }).getByRole("listitem"),
  ).toHaveCount(1);
  await expect(page.getByLabel("Internal note (optional)")).toHaveValue(
    "Customer called to cancel",
  );

  // Confirming submits the form as it is, notes included.
  await page.getByRole("button", { name: "Update status" }).click();
  await dialog.getByRole("button", { name: "Cancel shipment" }).click();
  await expect(page.getByTestId("form-status")).toHaveText("Status changed to Cancelled.");
  await expect(page.getByRole("list", { name: "Shipment history" })).toContainText(
    "Customer called to cancel",
  );
});

test("an unknown tracking code shows a friendly not-found page", async ({ page }) => {
  await page.goto("/track/WB-0000-0000");

  await expect(
    page.getByRole("heading", { name: "We could not find that shipment", level: 1 }),
  ).toBeVisible();
  await expect(page.getByLabel("Tracking code")).toBeVisible();
});
