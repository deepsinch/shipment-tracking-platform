import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { changeStatus, createShipment, recordCspViolations, signUp } from "./helpers";

/** Next keeps the previous route mounted but hidden after a navigation; count what is on screen. */
const shown = (page: Page, testId: string) => page.locator(`[data-testid="${testId}"]:visible`);

test("a status change emails the customer as a preview an admin can read, and unsubscribing stops the next one", async ({
  page,
  browser,
}) => {
  const violations = await recordCspViolations(page.context());
  await signUp(page, "Alex Admin");
  const customerEmail = `customer-${crypto.randomUUID()}@example.com`;
  const trackingCode = await createShipment(page, { recipientEmail: customerEmail });

  // The staff page says no email has been sent yet.
  await expect(shown(page, "email-notifications")).toContainText(customerEmail);
  await expect(shown(page, "email-message")).toHaveCount(0);

  await changeStatus(page, "Picked up", {
    publicNote: "Collected at the dock",
    internalNote: "Gate code 4711",
  });
  await expect(page.getByTestId("form-status")).toHaveText(/Status changed to Picked up/);

  // No provider is configured in e2e, so the message is stored as a preview (after the response).
  await expect
    .poll(
      async () => {
        await page.reload();
        return shown(page, "email-message").first().getAttribute("data-status");
      },
      { timeout: 20_000 },
    )
    .toBe("preview");
  await expect(shown(page, "email-message")).toContainText("Preview only");

  // The admin reads the exact message: public note yes, internal note no, working links.
  await page.goto("/dashboard/settings/email-previews");
  await expect(page.getByTestId("email-mode")).toContainText("Nothing is sent");
  const preview = page.getByTestId("email-preview").first();
  await expect(preview).toContainText(customerEmail);
  const text = (await preview.getByTestId("email-preview-text").textContent())!;
  expect(text).toContain("Picked up");
  expect(text).toContain(trackingCode);
  expect(text).toContain("Collected at the dock");
  expect(text).not.toContain("Gate code");
  const unsubscribeUrl = /(https?:\/\/\S+\/unsubscribe\/\S+)/.exec(text)![1]!;
  const trackingUrl = /(https?:\/\/\S+\/track\/\S+)/.exec(text)![1]!;
  expect(trackingUrl).toContain(`/track/${trackingCode}`);

  // The customer (no account, a fresh browser) follows the link: it asks, and only a click opts out.
  const customer = await browser.newContext();
  const customerViolations = await recordCspViolations(customer);
  const customerPage = await customer.newPage();
  await customerPage.goto(unsubscribeUrl);
  await expect(customerPage.getByRole("heading", { name: "Stop shipment emails?" })).toBeVisible();
  await expect(customerPage.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await customerPage.reload();
  await expect(customerPage.getByRole("heading", { name: "Stop shipment emails?" })).toBeVisible();
  await customerPage.getByRole("button", { name: "Stop these emails" }).click();
  await expect(customerPage.getByTestId("unsubscribed")).toBeVisible();
  await expect(customerPage.getByText("c***@example.com")).toBeVisible();

  // A forged link does nothing.
  await customerPage.goto(`${unsubscribeUrl.slice(0, -3)}AAA`);
  await expect(
    customerPage.getByRole("heading", { name: "This link does not work" }),
  ).toBeVisible();
  await customer.close();
  expect(customerViolations).toEqual([]);

  // The next status change sends nothing, and the staff page says why.
  await page.goto("/dashboard/shipments");
  await page.getByRole("link", { name: trackingCode }).first().click();
  await changeStatus(page, "In transit");
  await expect(page.getByTestId("form-status")).toHaveText(/Status changed to In transit/);
  await changeStatus(page, "Out for delivery");
  await expect(page.getByTestId("form-status")).toHaveText(/Status changed to Out for delivery/);
  await page.waitForTimeout(1_500);
  await page.reload();
  await expect(shown(page, "email-opted-out")).toBeVisible();
  await expect(shown(page, "email-message")).toHaveCount(1);
  // The staff page, the previews page and the public unsubscribe page all run under the CSP.
  expect(violations).toEqual([]);
});

test("an admin sees an empty previews page before any email was queued", async ({ page }) => {
  await signUp(page, "Alex Admin");
  await page.goto("/dashboard/settings/email-previews");
  await expect(page.getByRole("heading", { name: "Email previews", level: 1 })).toBeVisible();
  await expect(page.getByText("No previews yet")).toBeVisible();
});
