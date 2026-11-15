import AxeBuilder from "@axe-core/playwright";
import { blockMapTiles, expect, test } from "./fixtures";
import { addDriver, createShipment, expectLive, signIn, signUp } from "./helpers";

import type { Page } from "@playwright/test";

/**
 * Runs axe (WCAG 2.0/2.1 A and AA, plus best practices) on the page as it is now and fails on
 * serious and critical violations. The message names the rule, the impact and the offending
 * elements, so a failure is actionable without opening a report.
 */
async function expectAccessible(page: Page): Promise<void> {
  // Next streams a dynamic page's metadata after its body, so the heading can be visible a moment
  // before `<title>` exists; axe would report "document-title" for a page that is about to have one.
  // A page that never gets a title still fails, here instead of in axe.
  await expect(page).toHaveTitle(/\S/);
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    blocking.map((v) => ({
      rule: v.id,
      impact: v.impact,
      help: v.help,
      targets: v.nodes.map((n) => n.target.join(" ")),
    })),
    `axe violations on ${page.url()}`,
  ).toEqual([]);
}

test("public and auth pages have no serious accessibility violations", async ({ page }) => {
  for (const path of ["/", "/sign-in", "/sign-up"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectAccessible(page);
  }
});

test("the dashboard, settings, live map, driver app and tracking page have no serious accessibility violations", async ({
  page,
  browser,
}) => {
  test.slow();
  const adminEmail = await signUp(page, "Ada Dispatcher");

  // Dashboard list, in a desktop and in a phone-sized window (the mobile menu is part of the page).
  await expectAccessible(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectAccessible(page);
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
  await expectAccessible(page);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 800 });

  const trackingCode = await createShipment(page);
  await expectAccessible(page);

  const driverEmail = await addDriver(adminEmail, "Dan Driver");
  await page.reload();
  await page.getByLabel("Assigned driver").selectOption({ label: "Dan Driver" });
  await page.getByRole("button", { name: "Save driver" }).click();
  await expect(page.getByTestId("form-status")).toHaveText("Driver assigned.");

  await page.goto("/dashboard/map");
  await expect(page.getByRole("heading", { name: "Live map", level: 1 })).toBeVisible();
  await expectLive(page);
  await expectAccessible(page);

  const settings = [
    ["/dashboard/settings/api-keys", "API keys"],
    ["/dashboard/settings/webhooks", "Webhooks"],
    ["/dashboard/settings/email-previews", "Emails"],
  ] as const;
  for (const [path] of settings) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectAccessible(page);
  }

  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await blockMapTiles(phoneContext);
  const phone = await phoneContext.newPage();
  await signIn(phone, driverEmail);
  await expect(phone.getByRole("heading", { name: "My shipments", level: 1 })).toBeVisible();
  await expectAccessible(phone);
  await phone.getByRole("link", { name: new RegExp(trackingCode) }).click();
  await expect(phone.getByRole("heading", { name: trackingCode, level: 1 })).toBeVisible();
  await expectAccessible(phone);
  await phoneContext.close();

  await page.goto(`/track/${trackingCode}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectAccessible(page);
});

test("the mobile menu reaches every page, closes on Escape and marks the current page", async ({
  page,
}) => {
  await signUp(page, "Mona Menu");
  await page.setViewportSize({ width: 390, height: 844 });

  const trigger = page.getByRole("button", { name: "Menu" });
  await trigger.click();
  const menu = page.getByRole("dialog", { name: "Menu" });
  await expect(menu.getByRole("link", { name: "Shipments" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  for (const name of ["Live map", "API keys", "Webhooks", "Emails"]) {
    await expect(menu.getByRole("link", { name })).toBeVisible();
  }

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await menu.getByRole("link", { name: "Live map" }).click();
  await expect(page).toHaveURL("/dashboard/map");
  await expect(menu).toBeHidden();
  await trigger.click();
  await expect(menu.getByRole("link", { name: "Live map" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});
