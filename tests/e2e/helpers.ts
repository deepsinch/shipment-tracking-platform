import { execFile } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { promisify } from "node:util";

import { expect, type BrowserContext, type Page } from "@playwright/test";

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
 *
 * Each test's company is a different customer, so its browser context gets its own client
 * address (TEST-NET-3, reserved for documentation) in `x-forwarded-for`, the header the app's
 * rate limits trust from the platform proxy. Otherwise the suite's sign-ups would share one
 * address and hit the limit of 10 sign-ups per IP per hour.
 */
export async function signUp(page: Page, name = "Erin Dispatcher"): Promise<string> {
  const email = `e2e-${randomUUID()}@example.test`;
  const clientIp = `203.0.113.${randomInt(1, 255)}`;
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": clientIp });
  await page.goto("/sign-up");
  await page.getByLabel("Your name", { exact: true }).fill(name);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Company name", { exact: true }).fill("E2E Freight");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Shipments", level: 1 })).toBeVisible();
  return email;
}

/**
 * Cuts the page off from live updates (`/api/realtime`), for tests about what happens when a tab
 * did not hear about a change in time: optimistic concurrency, not realtime, is the guarantee.
 * Call it before the page navigates.
 */
export async function withoutLiveUpdates(page: Page): Promise<void> {
  await page.route("**/api/realtime", (route) => route.abort());
}

/** Waits until the page's realtime connection is established (the header's Live indicator). */
export async function expectLive(page: Page): Promise<void> {
  await expect(page.getByTestId("live-indicator")).toHaveAttribute("data-status", "live");
}

/**
 * Marks the page's window. The mark survives client-side re-renders (`router.refresh()`) but not
 * a reload, so `expectNotReloaded` proves an update arrived live.
 */
export async function markWindow(page: Page): Promise<void> {
  await page.evaluate(() => Object.assign(window, { __waybillNotReloaded: true }));
}

export async function expectNotReloaded(page: Page): Promise<void> {
  expect(await page.evaluate(() => "__waybillNotReloaded" in window)).toBe(true);
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

/** The shipment's stored latest position, read from the e2e database (or `databaseUrl`'s). */
export async function readPosition(
  trackingCode: string,
  databaseUrl = process.env.E2E_DATABASE_URL,
): Promise<{ lat: number; lng: number; accuracyM: number } | null> {
  const { stdout } = await promisify(execFile)(
    "pnpm",
    ["exec", "tsx", "--conditions=react-server", "tests/e2e/read-position.ts", trackingCode],
    { env: { ...process.env, DATABASE_URL: databaseUrl } },
  );
  return JSON.parse(stdout);
}

/** Books a shipment from the list page and returns its tracking code (on its detail page). */
export async function createShipment(
  page: Page,
  options: { recipientEmail?: string } = {},
): Promise<string> {
  await page.getByRole("link", { name: "New shipment" }).click();
  await expect(page.getByRole("heading", { name: "New shipment", level: 1 })).toBeVisible();

  const recipient = page.getByRole("group", { name: "Recipient" });
  await recipient.getByLabel("Name", { exact: true }).fill("Grace Recipient");
  await recipient.getByLabel("Reference (optional)").fill("PO-1001");
  if (options.recipientEmail)
    await recipient.getByLabel("Email (optional)").fill(options.recipientEmail);

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

/**
 * Records every Content-Security-Policy violation in the context's pages: the browser's
 * `securitypolicyviolation` events (registered before any page script runs) and its console
 * reports (which also cover workers). Returns the live list; a passing page leaves it empty.
 */
export async function recordCspViolations(context: BrowserContext): Promise<string[]> {
  const violations: string[] = [];
  await context.exposeFunction("__waybillCspViolation", (violation: string) => {
    violations.push(violation);
  });
  await context.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      const report = (window as unknown as { __waybillCspViolation(v: string): void })
        .__waybillCspViolation;
      report(
        `${event.violatedDirective} blocked ${event.blockedURI || "inline"} on ` +
          `${location.pathname} (${event.sourceFile}:${event.lineNumber})`,
      );
    });
  });
  context.on("console", (message) => {
    if (/Content[- ]Security[- ]Policy/i.test(message.text())) {
      violations.push(`console: ${message.text()}`);
    }
  });
  return violations;
}
