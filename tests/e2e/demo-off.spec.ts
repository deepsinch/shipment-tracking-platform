import { expect, test } from "./fixtures";

/**
 * The regular e2e server runs without demo mode (playwright.config.ts pins DEMO_MODE=false):
 * nothing of the demo may appear, and its endpoints must not exist. `demo.spec.ts` covers the
 * demo-on side against a second server.
 */

test("without demo mode there is no banner and no demo sign-in", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in", level: 1 })).toBeVisible();
  // The demo parts stream in after the shell; give them the chance to (wrongly) appear.
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("region", { name: "Demo notice" })).toHaveCount(0);
  await expect(page.getByTestId("demo-sign-in")).toHaveCount(0);
  await expect(page.getByText("Try the demo")).toHaveCount(0);
  await expect(page.getByText("data resets nightly")).toHaveCount(0);
});

test("the demo endpoints answer 404", async ({ request }) => {
  const tick = await request.post("/api/demo/tick");
  expect(tick.status()).toBe(404);

  // Even with a bearer token: demo mode is off, so the route does not exist.
  const reset = await request.get("/api/cron/reset-demo", {
    headers: { authorization: "Bearer anything-at-all" },
  });
  expect(reset.status()).toBe(404);
});
