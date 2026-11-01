import type { Browser, Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import {
  addDriver,
  changeStatus,
  createShipment,
  deliverFromDriverApp,
  recordCspViolations,
  signIn,
  signUp,
} from "./helpers";

/**
 * Proof of delivery, end to end: the driver's delivery sheet (printed name, signature drawn with
 * the mouse, keyboard-only delivery), what the dispatcher sees, and what the customer sees. The
 * e2e server has no Blob store, so photo capture is hidden here; photos are covered by the
 * integration tests (fake storage) and the demo spec (sample photo).
 */

/** A shipment assigned to a new driver and taken to "out for delivery", on the driver's phone. */
async function outForDelivery(
  page: Page,
  browser: Browser,
): Promise<{ trackingCode: string; phone: Page }> {
  const adminEmail = await signUp(page, "Olly Dispatcher");
  const trackingCode = await createShipment(page);
  const driverEmail = await addDriver(adminEmail, "Dina Driver");
  await page.reload();
  await page.getByLabel("Assigned driver").selectOption({ label: "Dina Driver" });
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
  return { trackingCode, phone };
}

/** Draws one stroke across the pad with the mouse (a stand-in for a finger: same pointer events). */
async function drawStroke(phone: Page, from: number, to: number) {
  const box = (await phone.getByTestId("signature-pad").boundingBox())!;
  const at = (fraction: number, wave = 0) => ({
    x: box.x + box.width * fraction,
    y: box.y + box.height * (0.5 + wave),
  });
  await phone.mouse.move(at(from).x, at(from).y);
  await phone.mouse.down();
  for (let step = 1; step <= 24; step += 1) {
    const fraction = from + ((to - from) * step) / 24;
    const point = at(fraction, 0.25 * Math.sin(step / 2));
    await phone.mouse.move(point.x, point.y, { steps: 2 });
  }
  await phone.mouse.up();
}

test("a driver delivers with a printed name and a drawn signature; staff and the customer see it", async ({
  page,
  browser,
}) => {
  const violations = await recordCspViolations(page.context());
  const { trackingCode, phone } = await outForDelivery(page, browser);

  await phone.getByLabel("Note for the customer (optional)").fill("Left with the neighbour");
  await phone.getByRole("button", { name: "Mark as delivered" }).click();
  const sheet = phone.getByRole("dialog", { name: `Deliver ${trackingCode}` });
  await expect(sheet).toBeVisible();
  // The name field is where the cursor starts, and photo capture is off without storage.
  await expect(sheet.getByLabel("Recipient's printed name")).toBeFocused();
  await expect(sheet.getByRole("button", { name: "Take a photo" })).toHaveCount(0);

  // The name is required.
  await sheet.getByRole("button", { name: "Confirm delivery" }).click();
  await expect(sheet.getByTestId("form-alert")).toContainText(
    "Please correct the highlighted fields",
  );
  await expect(sheet.getByText("Enter the recipient's printed name")).toBeVisible();
  await expect(sheet).toBeVisible();

  // Draw, undo, draw again; the text alternative follows.
  const pad = sheet.getByTestId("signature-pad");
  await expect(sheet.getByTestId("signature-summary")).toHaveText("No signature was drawn.");
  await expect(sheet.getByRole("button", { name: "Undo" })).toBeDisabled();
  await drawStroke(phone, 0.1, 0.5);
  await expect(pad).toHaveAttribute("data-strokes", "1");
  await sheet.getByRole("button", { name: "Undo" }).click();
  await expect(pad).toHaveAttribute("data-strokes", "0");
  await drawStroke(phone, 0.1, 0.9);
  await drawStroke(phone, 0.2, 0.8);
  await expect(pad).toHaveAttribute("data-strokes", "2");
  await expect(sheet.getByTestId("signature-summary")).toHaveText(
    "A hand-drawn signature of 2 strokes.",
  );
  await expect(pad).toHaveAccessibleName(/A hand-drawn signature of 2 strokes/);

  // What was typed before the failed attempt is not lost on another one.
  await sheet.getByLabel("Recipient's printed name").fill("Grace R.");
  await sheet.getByRole("button", { name: "Confirm delivery" }).click();
  await expect(phone.getByTestId("form-status")).toHaveText("Status changed to Delivered.");
  await expect(sheet).toBeHidden();
  await expect(
    phone.getByText("This shipment is delivered. Nothing more to do here."),
  ).toBeVisible();

  // The dispatcher: the proof card with the name and the signature drawn from its strokes.
  await page.reload();
  const card = page.locator("[data-testid=proof-of-delivery]:visible");
  await expect(card.getByRole("heading", { name: "Proof of delivery" })).toBeVisible();
  await expect(card).toContainText("Grace R.");
  await expect(card).toContainText("Recorded by Dina Driver");
  const signature = card.getByRole("img", { name: "A hand-drawn signature of 2 strokes." });
  await expect(signature).toBeVisible();
  await expect(signature.locator("path")).toHaveCount(2);
  await expect(card).toContainText("No photo was taken.");
  // The note typed on the page behind the sheet travelled with the delivery.
  await expect(page.getByRole("list", { name: "Shipment history" })).toContainText(
    "Left with the neighbour",
  );

  // The customer: the name, and neither the signature nor anything else of the proof.
  const customer = await browser.newPage();
  await customer.goto(`/track/${trackingCode}`);
  await expect(customer.getByTestId("signed-by")).toHaveText("Signed by Grace R.");
  await expect(customer.locator("svg[role=img]")).toHaveCount(0);
  await expect(customer.getByText("Proof of delivery")).toHaveCount(0);

  expect(violations).toEqual([]);
});

test("a driver can deliver with the keyboard and the name alone", async ({ page, browser }) => {
  const { trackingCode, phone } = await outForDelivery(page, browser);

  // Open from the keyboard; backing out with Escape changes nothing.
  await phone.getByRole("button", { name: "Mark as delivered" }).focus();
  await phone.keyboard.press("Enter");
  const sheet = phone.getByRole("dialog", { name: `Deliver ${trackingCode}` });
  await expect(sheet).toBeVisible();
  await phone.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(phone.getByRole("button", { name: "Mark as delivered" })).toBeVisible();

  await phone.getByRole("button", { name: "Mark as delivered" }).focus();
  await phone.keyboard.press("Enter");
  await expect(sheet.getByLabel("Recipient's printed name")).toBeFocused();
  // Tab order: name, then (Undo and Clear are disabled with nothing drawn) the two buttons.
  await phone.keyboard.type("Grace Recipient");
  await phone.keyboard.press("Tab");
  await expect(sheet.getByRole("button", { name: "Not yet" })).toBeFocused();
  await phone.keyboard.press("Tab");
  await expect(sheet.getByRole("button", { name: "Confirm delivery" })).toBeFocused();
  await phone.keyboard.press("Enter");

  await expect(phone.getByTestId("form-status")).toHaveText("Status changed to Delivered.");

  await page.reload();
  const card = page.locator("[data-testid=proof-of-delivery]:visible");
  await expect(card).toContainText("Grace Recipient");
  await expect(card).toContainText("The recipient did not sign. The printed name is the proof.");
  await expect(card.getByRole("img")).toHaveCount(0);

  await phone.goto(`/track/${trackingCode}`);
  await expect(phone.getByTestId("signed-by")).toHaveText("Signed by Grace Recipient");
});

test("staff can mark a delivery from the office, recorded as no proof", async ({ page }) => {
  await signUp(page, "Stan Dispatcher");
  const trackingCode = await createShipment(page);

  for (const status of ["Picked up", "In transit", "Out for delivery"]) {
    await changeStatus(page, status);
    await expect(page.getByTestId("form-status")).toHaveText(`Status changed to ${status}.`);
  }
  await changeStatus(page, "Delivered");
  await page
    .getByRole("alertdialog", { name: `Mark ${trackingCode} as delivered?` })
    .getByRole("button", { name: "Confirm delivery" })
    .click();
  await expect(page.getByTestId("form-status")).toHaveText("Status changed to Delivered.");

  await expect(page.locator("[data-testid=proof-of-delivery]:visible")).toContainText(
    "No proof of delivery was recorded.",
  );
  await page.goto(`/track/${trackingCode}`);
  await expect(page.getByTestId("tracking-status")).toHaveText("Delivered");
  await expect(page.getByTestId("signed-by")).toHaveCount(0);
});

test("a delivery photo is private: the route answers staff and refuses visitors", async ({
  page,
  browser,
}) => {
  const { phone } = await outForDelivery(page, browser);
  await deliverFromDriverApp(phone);
  await expect(phone.getByTestId("form-status")).toHaveText("Status changed to Delivered.");

  // No photo exists here, so the route says not found to staff; anonymous visitors are not
  // let in at all.
  const shipmentUrl = page.url();
  const photoUrl = `${shipmentUrl}/proof-photo`;
  const staff = await page.request.get(photoUrl);
  expect(staff.status()).toBe(404);

  const visitor = await browser.newContext({ baseURL: new URL(shipmentUrl).origin });
  const anonymous = await visitor.request.get(photoUrl, { maxRedirects: 0 });
  expect([307, 401]).toContain(anonymous.status());
  await visitor.close();
});
