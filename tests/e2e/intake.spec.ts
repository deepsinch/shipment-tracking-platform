import { INTAKE_FIXTURES } from "../../src/server/intake/fixtures";
import { expect, test } from "./fixtures";
import { signUp } from "./helpers";

/**
 * AI intake, end to end, with the recorded-answers fake model (the e2e server runs with
 * INTAKE_USE_FAKE_MODEL; nothing here can reach the live API).
 */

const fixture = (id: string) => INTAKE_FIXTURES.find((f) => f.id === id)!;

test("pasting an email fills the form as a draft the dispatcher edits and books", async ({
  page,
}) => {
  await signUp(page, "Ines Intake");
  await page.getByRole("link", { name: "New shipment" }).click();
  const panel = page.getByTestId("intake-panel");
  await expect(panel.getByRole("heading", { name: "Paste a request email" })).toBeVisible();
  // No draft yet: no note, blank fields.
  await expect(page.getByTestId("draft-note")).toHaveCount(0);

  const email = fixture("en-country-names-and-pounds");
  await panel.getByLabel("Request email").fill(email.email);
  await panel.getByRole("button", { name: "Fill the form from this email" }).click();

  // The draft: values in real inputs, converted (country names to codes, pounds to kilograms), and
  // an honest note about what was and was not found.
  const note = page.getByTestId("draft-note");
  await expect(note).toContainText("AI draft: check every field");
  await expect(note).toContainText("Not found in the email, left blank");
  await expect(note).toContainText("Recipient email");
  const recipient = page.getByRole("group", { name: "Recipient" });
  await expect(recipient.getByLabel("Name", { exact: true })).toHaveValue("Pieter de Vries");
  await expect(recipient.getByLabel("Email (optional)")).toHaveValue("");
  const pickup = page.getByRole("group", { name: "Pickup" });
  await expect(pickup.getByLabel("Pickup address")).toHaveValue("14 Trafford Road");
  await expect(pickup.getByLabel("Pickup city")).toHaveValue("Manchester");
  await expect(pickup.getByLabel("Country code")).toHaveValue("GB");
  const delivery = page.getByRole("group", { name: "Delivery" });
  await expect(delivery.getByLabel("Delivery city")).toHaveValue("Rotterdam");
  await expect(delivery.getByLabel("Country code")).toHaveValue("NL");
  await expect(page.getByLabel("Weight (kg)")).toHaveValue("204.12");
  await expect(page.getByLabel("Service level")).toHaveValue("standard");

  // Nothing was booked by reading the email: still on the form, and the list has no shipment yet.
  await expect(page).toHaveURL(/\/dashboard\/shipments\/new$/);

  // The dispatcher corrects a field and books it through the normal form.
  await recipient.getByLabel("Name", { exact: true }).fill("Pieter de Vries (reception)");
  await page.getByRole("button", { name: "Create shipment" }).click();
  const heading = page.getByRole("heading", { level: 1, name: /^WB-[0-9A-Z]{4}-[0-9A-Z]{4}$/ });
  await expect(heading).toBeVisible();
  await expect(page.getByText("Pieter de Vries (reception)")).toBeVisible();
  await expect(page.getByText("204.12 kg")).toBeVisible();
});

test("missing and invented fields are left blank, and the draft says so", async ({ page }) => {
  await signUp(page, "Ines Intake");
  await page.getByRole("link", { name: "New shipment" }).click();
  const email = fixture("en-missing-fields");
  await page.getByLabel("Request email").fill(email.email);
  await page.getByRole("button", { name: "Fill the form from this email" }).click();

  await expect(page.getByTestId("draft-note")).toContainText("Not found in the email, left blank");
  await expect(page.getByTestId("draft-note")).toContainText("Weight");
  await expect(page.getByRole("group", { name: "Pickup" }).getByLabel("Pickup city")).toHaveValue(
    "Utrecht",
  );
  await expect(page.getByLabel("Weight (kg)")).toHaveValue("");
  // The made-up address in the recording is not in the email, so it was dropped.
  await expect(
    page.getByRole("group", { name: "Recipient" }).getByLabel("Email (optional)"),
  ).toHaveValue("");
});

test("an email the assistant cannot read says so and keeps the text", async ({ page }) => {
  await signUp(page, "Ines Intake");
  await page.getByRole("link", { name: "New shipment" }).click();

  // No recording for this text: the fake fails like an unreachable model would.
  await page.getByLabel("Request email").fill("Hello, please collect a box tomorrow.");
  await page.getByRole("button", { name: "Fill the form from this email" }).click();

  await expect(page.getByTestId("form-alert")).toContainText("could not be read right now");
  await expect(page.getByLabel("Request email")).toHaveValue(
    "Hello, please collect a box tomorrow.",
  );
  await expect(page.getByTestId("draft-note")).toHaveCount(0);
});

test("a blank paste asks for the email", async ({ page }) => {
  await signUp(page, "Ines Intake");
  await page.getByRole("link", { name: "New shipment" }).click();
  await page.getByRole("button", { name: "Fill the form from this email" }).click();
  await expect(page.getByTestId("form-alert")).toContainText("Paste the email");
});
