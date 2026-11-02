import { expect, test } from "./fixtures";

import { addDriver, createShipment, signIn, signUp } from "./helpers";

import type { Page } from "@playwright/test";

const NOTICE = "This shipment was updated while you were editing.";

/** Records whether the "updated while you were editing" notice ever appears, even briefly. */
async function watchForNotice(page: Page): Promise<void> {
  await page.evaluate((text) => {
    const w = window as unknown as { __noticeSeen?: boolean };
    w.__noticeSeen = false;
    const check = () => {
      if (document.body.innerText.includes(text)) w.__noticeSeen = true;
    };
    new MutationObserver(check).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }, NOTICE);
}

/** Lets late realtime events and the notice's delay play out, then asserts it never showed. */
async function expectNoNotice(page: Page): Promise<void> {
  await page.waitForTimeout(2_000);
  const seen = await page.evaluate(
    () => (window as unknown as { __noticeSeen?: boolean }).__noticeSeen,
  );
  expect(seen).toBe(false);
  await expect(page.getByText(NOTICE)).toHaveCount(0);
}

test("submitting your own status change or reassignment never raises the update notice", async ({
  page,
  browser,
}) => {
  const adminEmail = await signUp(page, "Own Dispatcher");
  const trackingCode = await createShipment(page);
  await addDriver(adminEmail, "First Driver");
  const secondEmail = await addDriver(adminEmail, "Second Driver");
  await page.reload();
  await watchForNotice(page);

  // Staff: reassignment.
  await page.getByLabel("Assigned driver").selectOption({ label: "First Driver" });
  await page.getByRole("button", { name: "Save driver" }).click();
  await expect(page.getByTestId("form-status")).toHaveText("Driver assigned.");
  await expectNoNotice(page);

  await page.getByLabel("Assigned driver").selectOption({ label: "Second Driver" });
  await page.getByRole("button", { name: "Save driver" }).click();
  await expect(page.getByRole("list", { name: "Shipment history" })).toContainText(
    "Reassigned from First Driver to Second Driver",
  );
  await expectNoNotice(page);

  // Staff: status change.
  await page.getByLabel("New status").selectOption({ label: "Picked up" });
  await page.getByLabel("Internal note (optional)").fill("Own note");
  await page.getByRole("button", { name: "Update status" }).click();
  await expect(page.getByRole("list", { name: "Shipment history" })).toContainText("Picked up");
  await expectNoNotice(page);

  // Driver app: the status form.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await signIn(phone, secondEmail);
  await phone.getByRole("link", { name: new RegExp(trackingCode) }).click();
  await expect(phone.getByRole("heading", { name: trackingCode, level: 1 })).toBeVisible();
  await watchForNotice(phone);
  await phone.getByLabel("Note for the customer (optional)").fill("On my way");
  await phone.getByRole("button", { name: "Mark as in transit" }).click();
  await expect(phone.getByTestId("form-status")).toHaveText("Status changed to In transit.");
  await expectNoNotice(phone);
  await phone.close();
});
