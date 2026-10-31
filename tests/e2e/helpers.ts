import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import { expect, type Page } from "@playwright/test";

/**
 * Locator notes for this app:
 * - Next keeps the previous route mounted but hidden after a client navigation, so prefer role and
 *   label locators (they skip hidden elements) over CSS or test ids on shared markup.
 * - Next's route announcer has role="alert"; form messages are found by test id instead.
 */

const PASSWORD = "correct-horse-battery";

/**
 * Signs up a new user, who becomes the admin of a new company, and lands on the shipment list.
 * Returns their email.
 */
export async function signUp(page: Page, name = "Erin Dispatcher"): Promise<string> {
  const email = `e2e-${randomUUID()}@example.test`;
  await page.goto("/sign-up");
  await page.getByLabel("Your name", { exact: true }).fill(name);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Company name", { exact: true }).fill("E2E Freight");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Shipments", level: 1 })).toBeVisible();
  return email;
}

/** Signs in with the shared e2e password; where the user lands depends on their role. */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/**
 * Adds a driver to the admin's company and returns their email. There is no member management UI
 * yet, so this runs `add-driver.ts`, which uses Better Auth like the demo seed (no raw SQL). It
 * runs as a separate process because server modules need the `react-server` condition.
 */
export async function addDriver(adminEmail: string, name: string): Promise<string> {
  const email = `e2e-driver-${randomUUID()}@example.test`;
  await promisify(execFile)(
    "pnpm",
    [
      "exec",
      "tsx",
      "--conditions=react-server",
      "tests/e2e/add-driver.ts",
      adminEmail,
      name,
      email,
      PASSWORD,
    ],
    // The same database the app under test uses (see playwright.config.ts).
    { env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL } },
  );
  return email;
}

/** The shipment's stored latest position (no map UI yet), read from the e2e database. */
export async function readPosition(
  trackingCode: string,
): Promise<{ lat: number; lng: number; accuracyM: number } | null> {
  const { stdout } = await promisify(execFile)(
    "pnpm",
    ["exec", "tsx", "--conditions=react-server", "tests/e2e/read-position.ts", trackingCode],
    { env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL } },
  );
  return JSON.parse(stdout);
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
