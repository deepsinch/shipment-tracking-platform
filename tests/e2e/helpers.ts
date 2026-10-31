import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";

/**
 * Locator notes for this app:
 * - Next keeps the previous route mounted but hidden after a client navigation, so prefer role and
 *   label locators (they skip hidden elements) over CSS or test ids on shared markup.
 * - Next's route announcer has role="alert"; form messages are found by test id instead.
 */

/** Signs up a new user, who becomes the admin of a new company, and lands on the shipment list. */
export async function signUp(page: Page, name = "Erin Dispatcher"): Promise<void> {
  await page.goto("/sign-up");
  await page.getByLabel("Your name", { exact: true }).fill(name);
  await page.getByLabel("Email", { exact: true }).fill(`e2e-${randomUUID()}@example.test`);
  await page.getByLabel("Password", { exact: true }).fill("correct-horse-battery");
  await page.getByLabel("Company name", { exact: true }).fill("E2E Freight");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Shipments", level: 1 })).toBeVisible();
}

/** Books a shipment from the list page and returns its tracking code (on its detail page). */
export async function createShipment(page: Page): Promise<string> {
  await page.getByRole("link", { name: "New shipment" }).click();
  await expect(page.getByRole("heading", { name: "New shipment", level: 1 })).toBeVisible();

  const recipient = page.getByRole("group", { name: "Recipient" });
  await recipient.getByLabel("Name", { exact: true }).fill("Grace Recipient");
  await recipient.getByLabel("Reference (optional)").fill("PO-1001");

  const pickup = page.getByRole("group", { name: "Pickup" });
  await pickup.getByLabel("Pickup address").fill("Wilhelminakade 1");
  await pickup.getByLabel("Pickup city").fill("Rotterdam");
  await pickup.getByLabel("Country code").fill("NL");

  const delivery = page.getByRole("group", { name: "Delivery" });
  await delivery.getByLabel("Delivery address").fill("Meir 1");
  await delivery.getByLabel("Delivery city").fill("Antwerp");
  await delivery.getByLabel("Country code").fill("BE");

  await page.getByLabel("Weight (kg)").fill("12.5");
  await page.getByRole("button", { name: "Create shipment" }).click();

  const heading = page.getByRole("heading", { level: 1, name: /^WB-[0-9A-Z]{4}-[0-9A-Z]{4}$/ });
  await expect(heading).toBeVisible();
  return (await heading.textContent())!.trim();
}

/** Submits the status form on a shipment's detail page. */
export async function changeStatus(
  page: Page,
  status: string,
  notes: { city?: string; publicNote?: string; internalNote?: string } = {},
): Promise<void> {
  await page.getByLabel("New status").selectOption({ label: status });
  const fields = [
    ["City (optional)", notes.city],
    ["Note for the customer (optional)", notes.publicNote],
    ["Internal note (optional)", notes.internalNote],
  ] as const;
  for (const [label, value] of fields) {
    if (value) await page.getByLabel(label).fill(value);
  }
  await page.getByRole("button", { name: "Update status" }).click();
}
