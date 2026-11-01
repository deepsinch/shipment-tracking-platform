import http from "node:http";
import type { AddressInfo } from "node:net";

import { verifyWebhookSignature } from "../../src/domain/webhook-signature";

import { expect, test } from "./fixtures";
import { addDriver, changeStatus, createShipment, signIn, signUp } from "./helpers";

type Received = { headers: http.IncomingHttpHeaders; body: string };

/** A receiver on this machine: the app under test reaches it because the e2e server runs with WEBHOOKS_ALLOW_LOCAL_TARGETS. */
async function startReceiver() {
  const received: Received[] = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      received.push({ headers: request.headers, body });
      response.writeHead(204).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/waybill`,
    received,
    async stop() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

test("an admin adds a webhook and the receiver gets a correctly signed status change", async ({
  page,
}) => {
  const receiver = await startReceiver();
  try {
    await signUp(page, "Alex Admin");
    const trackingCode = await createShipment(page);

    await page.goto("/dashboard/settings/webhooks");
    await expect(page.getByRole("heading", { name: "Webhooks", level: 1 })).toBeVisible();
    await expect(page.getByText("No webhooks yet")).toBeVisible();

    // The form says what is wrong and keeps what was typed.
    await page.getByLabel("Endpoint URL").fill("http://example.com/hook");
    await page.getByRole("button", { name: "Add webhook" }).click();
    await expect(page.getByText("The URL must start with https://")).toBeVisible();
    await expect(page.getByText("Choose at least one event")).toBeVisible();
    await expect(page.getByLabel("Endpoint URL")).toHaveValue("http://example.com/hook");

    await page.getByLabel("Endpoint URL").fill(receiver.url);
    await page.getByLabel(/Status changed/).check();
    await page.getByRole("button", { name: "Add webhook" }).click();

    // The signing secret is shown once.
    const secret = (await page.getByTestId("new-webhook-secret").textContent())!.trim();
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    const endpoint = page.getByTestId("webhook-endpoint");
    await expect(endpoint).toContainText(receiver.url);
    await expect(endpoint).not.toContainText(secret);
    await expect(endpoint).toContainText("Nothing sent yet");

    // A status change on a shipment triggers the delivery once the response is sent.
    await page.goto("/dashboard/shipments");
    await page.getByRole("link", { name: trackingCode }).first().click();
    await changeStatus(page, "Picked up", {
      publicNote: "Collected",
      internalNote: "Gate code 1234",
    });
    await expect(page.getByTestId("form-status")).toHaveText(/Status changed to Picked up/);

    await expect.poll(() => receiver.received.length, { timeout: 15_000 }).toBe(1);
    const [delivery] = receiver.received;
    expect(delivery!.headers["waybill-event"]).toBe("shipment.status_changed");
    expect(delivery!.headers["waybill-delivery"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(delivery!.headers["content-type"]).toBe("application/json");

    // Verified exactly as docs/api.md tells a receiver to.
    expect(
      verifyWebhookSignature(
        secret,
        String(delivery!.headers["waybill-signature"]),
        delivery!.body,
        Math.floor(Date.now() / 1000),
      ),
    ).toEqual({ valid: true });

    const event = JSON.parse(delivery!.body);
    expect(event).toMatchObject({
      type: "shipment.status_changed",
      data: {
        version: 2,
        shipment: { trackingCode, status: "picked_up" },
        change: { fromStatus: "created", toStatus: "picked_up", publicNote: "Collected" },
      },
    });
    // Internal notes and internal ids stay inside.
    expect(delivery!.body).not.toContain("Gate code");
    expect(Object.keys(event.data.shipment)).not.toContain("organizationId");

    // The log shows it as succeeded.
    await page.goto("/dashboard/settings/webhooks");
    const row = page.getByTestId("webhook-delivery");
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute("data-status", "succeeded");
    await expect(row).toContainText("Status changed");
    await expect(row).toContainText("HTTP 204");

    // Resend creates a new delivery of the same event.
    await page.getByRole("button", { name: /^Resend/ }).click();
    await expect(page.getByTestId("form-status")).toHaveText(/Queued again/);
    await expect.poll(() => receiver.received.length, { timeout: 15_000 }).toBe(2);
    expect(JSON.parse(receiver.received[1]!.body).id).toBe(event.id);
    expect(receiver.received[1]!.headers["waybill-delivery"]).not.toBe(
      delivery!.headers["waybill-delivery"],
    );

    // Disabling stops deliveries; the earlier ones stay in the log.
    await page.getByRole("button", { name: /^Disable/ }).click();
    await expect(page.getByTestId("webhook-endpoint")).toContainText("Disabled by an admin");
    await page.goto("/dashboard/shipments");
    await page.getByRole("link", { name: trackingCode }).first().click();
    await changeStatus(page, "In transit");
    await expect(page.getByTestId("form-status")).toHaveText(/Status changed to In transit/);
    await page.waitForTimeout(1_500);
    expect(receiver.received).toHaveLength(2);

    // Rotating shows the new secret once, and the old one stops signing.
    await page.goto("/dashboard/settings/webhooks");
    await page.getByRole("button", { name: /^Enable/ }).click();
    await expect(page.getByRole("button", { name: /^Disable/ })).toBeVisible();
    await page.getByRole("button", { name: /^Rotate secret/ }).click();
    await page.getByRole("button", { name: "Rotate secret", exact: true }).click();
    const rotated = (await page.getByTestId("rotated-webhook-secret").textContent())!.trim();
    expect(rotated).toMatch(/^whsec_/);
    expect(rotated).not.toBe(secret);
  } finally {
    await receiver.stop();
  }
});

test("only admins reach the webhooks page", async ({ page }) => {
  const adminEmail = await signUp(page, "Alex Admin");
  const driverEmail = await addDriver(adminEmail, "Dries Driver");

  await page.context().clearCookies();
  await signIn(page, driverEmail);
  await expect(page).toHaveURL(/\/driver/);
  await page.goto("/dashboard/settings/webhooks");
  await expect(page).toHaveURL(/\/driver/);
});
