import { expect, test } from "./fixtures";

import { addDriver, createShipment, signIn, signUp } from "./helpers";

test("an admin creates an API key, an integration lists shipments with it, and revoking stops it", async ({
  page,
  request,
}) => {
  await signUp(page, "Alex Admin");
  const trackingCode = await createShipment(page);

  await page.goto("/dashboard/settings/api-keys");
  await expect(page.getByRole("heading", { name: "API keys", level: 1 })).toBeVisible();
  await expect(page.getByText("No API keys yet")).toBeVisible();

  // Nothing ticked: the form says what is missing and keeps the typed name.
  await page.getByLabel("Name", { exact: true }).fill("ERP integration");
  await page.getByRole("button", { name: "Create key" }).click();
  await expect(page.getByTestId("form-alert")).toHaveText(/Please correct the highlighted fields/);
  await expect(page.getByText("Choose at least one scope")).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("ERP integration");

  await page.getByLabel(/Read shipments/).check();
  await page.getByRole("button", { name: "Create key" }).click();

  // The secret is shown once, with the list below showing only its prefix.
  const secret = (await page.getByTestId("new-api-key").textContent())!.trim();
  expect(secret).toMatch(/^wb_live_[A-Za-z0-9_-]{43}$/);
  await expect(page.getByRole("button", { name: "Copy key" })).toBeVisible();
  const row = page.locator(`[data-testid="api-key-row"]:visible`);
  await expect(row).toContainText("ERP integration");
  await expect(row).toContainText(`${secret.slice(0, 12)}…`);
  await expect(row).not.toContainText(secret);
  await expect(row).toContainText("Never");

  // An integration (no cookies, only the key) lists the shipment the dispatcher booked.
  const headers = { authorization: `Bearer ${secret}` };
  const list = await request.get("/api/v1/shipments", { headers });
  expect(list.status()).toBe(200);
  const body = await list.json();
  expect(body.data.map((shipment: { trackingCode: string }) => shipment.trackingCode)).toEqual([
    trackingCode,
  ]);
  const detail = await request.get(`/api/v1/shipments/${body.data[0].id}`, { headers });
  expect(detail.headers()["etag"]).toBe('"1"');
  // It was given the read scope only.
  const create = await request.post("/api/v1/shipments", { headers, data: {} });
  expect(create.status()).toBe(403);
  expect(create.headers()["content-type"]).toBe("application/problem+json");
  // Public tracking needs no key.
  const tracking = await request.get(`/api/v1/tracking/${trackingCode}`);
  expect(tracking.status()).toBe(200);

  // The secret is gone after a reload, and "last used" has been recorded.
  await page.reload();
  await expect(page.getByTestId("new-api-key")).toHaveCount(0);
  await expect(page.locator(`[data-testid="api-key-row"]:visible`)).not.toContainText("Never");

  // Revoking asks first, and takes effect at once.
  await page.getByRole("button", { name: "Revoke key ERP integration" }).click();
  await page.getByRole("button", { name: "Keep key" }).click();
  expect((await request.get("/api/v1/shipments", { headers })).status()).toBe(200);

  await page.getByRole("button", { name: "Revoke key ERP integration" }).click();
  await page.getByRole("button", { name: "Revoke key", exact: true }).click();
  await expect(page.locator(`[data-testid="api-key-row"]:visible`)).toContainText("Revoked");
  const revoked = await request.get("/api/v1/shipments", { headers });
  expect(revoked.status()).toBe(401);
});

test("serves the OpenAPI document", async ({ request }) => {
  const response = await request.get("/api/v1/openapi.json");
  expect(response.status()).toBe(200);
  expect((await response.json()).openapi).toBe("3.1.0");
});

test("drivers get no access to API keys", async ({ page }) => {
  const adminEmail = await signUp(page, "Alex Admin");
  const driverEmail = await addDriver(adminEmail, "Dries Driver");

  await page.context().clearCookies();
  await signIn(page, driverEmail);
  await expect(page).toHaveURL(/\/driver/);
  await page.goto("/dashboard/settings/api-keys");
  await expect(page).toHaveURL(/\/driver/);
});
