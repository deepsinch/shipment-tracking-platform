import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  INTAKE_DAILY_LIMIT_DEMO,
  INTAKE_DAILY_LIMIT_PER_ORGANIZATION,
  INTAKE_MAX_BYTES,
} from "@/domain/intake";
import type { AuthContext } from "@/server/auth/auth-context";
import { consumeRateLimit, RATE_LIMITS } from "@/server/auth/rate-limit";
import { getDb } from "@/server/db/client";
import { shipments } from "@/server/db/schema";
import { FIXTURE_RESPONSES, INTAKE_FIXTURES } from "@/server/intake/fixtures";
import { createFakeIntakeModel, IntakeModelError, type IntakeModel } from "@/server/intake/model";

import { createTestContext, createTestOrganization } from "../../../tests/integration/fixtures";
import { extractShipmentDraft } from "./intake";

const fake = createFakeIntakeModel(FIXTURE_RESPONSES);
const complete = INTAKE_FIXTURES[0]!;

/** A model that counts its calls and answers like the fake. */
function countingModel() {
  const calls: string[] = [];
  const model: IntakeModel = {
    name: "counting",
    async extract(input) {
      calls.push(input.emailText);
      return fake.extract(input);
    },
  };
  return { model, calls };
}

describe("extractShipmentDraft", () => {
  let orgId: string;
  let dispatcher: AuthContext;
  let driver: AuthContext;

  beforeAll(async () => {
    orgId = (await createTestOrganization("Intake Freight")).id;
    dispatcher = await createTestContext(orgId, "dispatcher");
    driver = await createTestContext(orgId, "driver");
  });
  afterEach(() => vi.restoreAllMocks());

  const ask = (
    ctx: AuthContext,
    emailText: unknown,
    deps: Parameters<typeof extractShipmentDraft>[2] = {},
  ) => extractShipmentDraft(ctx, { emailText }, { model: fake, ...deps });

  const shipmentCount = async (organizationId: string) =>
    (await getDb().select().from(shipments).where(eq(shipments.organizationId, organizationId)))
      .length;

  it("is off without a key: the real configuration has no model, so the feature does not exist", async () => {
    // No `model` passed: the deployment's own (the test environment sets no ANTHROPIC_API_KEY).
    const result = await extractShipmentDraft(dispatcher, { emailText: complete.email });
    expect(result).toEqual({ ok: false, reason: "disabled" });
    expect(
      await extractShipmentDraft(dispatcher, { emailText: complete.email }, { model: null }),
    ).toEqual({
      ok: false,
      reason: "disabled",
    });
  });

  it("returns a checked draft for a dispatcher and an admin", async () => {
    const result = await ask(dispatcher, complete.email);
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.draft.values.recipientName).toBe("Grace Hopper");
    expect(result.draft.values.weightKg).toBe("12.5");
    expect(result.draft.status.weightKg).toBe("found");

    const admin = await createTestContext(orgId, "admin");
    expect((await ask(admin, complete.email)).ok).toBe(true);
  });

  it("refuses drivers, who cannot book shipments, before any model call", async () => {
    const { model, calls } = countingModel();
    expect(await ask(driver, complete.email, { model })).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(calls).toEqual([]);
  });

  it("never books: no shipment is created, whatever the email says", async () => {
    const before = await shipmentCount(orgId);
    for (const fixture of INTAKE_FIXTURES) {
      const result = await ask(dispatcher, fixture.email);
      expect(result.ok).toBe(true);
    }
    expect(await shipmentCount(orgId)).toBe(before);
  });

  it("the injection fixture gets plain extraction: values for the form and nothing else", async () => {
    const injection = INTAKE_FIXTURES.find((fixture) => fixture.id === "en-prompt-injection")!;
    const result = await ask(dispatcher, injection.email);
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(Object.keys(result)).toEqual(["ok", "draft"]);
    expect(result.draft.values.weightKg).toBe("30");
    expect(JSON.stringify(result)).not.toMatch(/mallory|delivered|admin mode/i);
  });

  describe("input", () => {
    it.each([
      ["empty", ""],
      ["blank", "   \n "],
      ["not text", 42],
      ["missing", undefined],
    ])(
      "rejects a %s paste without calling the model or using the allowance",
      async (_label, text) => {
        const { model, calls } = countingModel();
        const consume = vi.fn();
        const result = await ask(dispatcher, text, { model, consume });
        expect(result).toMatchObject({ ok: false, reason: "validation" });
        expect(calls).toEqual([]);
        expect(consume).not.toHaveBeenCalled();
      },
    );

    it("caps the email at 20 KB, counted in bytes", async () => {
      const { model, calls } = countingModel();
      const atLimit = "a".repeat(INTAKE_MAX_BYTES);
      const consume = vi.fn(async () => ({ limited: false as const }));

      const tooLong = await ask(dispatcher, `${atLimit}b`, { model, consume });
      expect(tooLong).toMatchObject({
        ok: false,
        reason: "validation",
        fieldErrors: { emailText: [expect.stringContaining("too long")] },
      });
      // Multi-byte characters count by bytes, not characters.
      const wide = await ask(dispatcher, "é".repeat(INTAKE_MAX_BYTES / 2 + 1), { model, consume });
      expect(wide).toMatchObject({ ok: false, reason: "validation" });
      expect(calls).toEqual([]);

      // Exactly at the limit is fine (the fake has no recording, so the model fails, which is
      // beyond the size check).
      expect(await ask(dispatcher, atLimit, { model, consume })).toEqual({
        ok: false,
        reason: "model_failed",
      });
    });
  });

  describe("daily caps", () => {
    it("allows the daily number per organization, then refuses with a retry time, without calling the model", async () => {
      const org = (await createTestOrganization("Capped Freight")).id;
      const user = await createTestContext(org, "dispatcher");
      const { model, calls } = countingModel();
      const now = new Date("2026-11-02T10:00:00Z");

      for (let i = 0; i < INTAKE_DAILY_LIMIT_PER_ORGANIZATION; i += 1) {
        const result = await ask(user, complete.email, { model, now: () => now });
        expect(result.ok, `request ${i + 1}`).toBe(true);
      }
      const refused = await ask(user, complete.email, { model, now: () => now });
      expect(refused).toMatchObject({ ok: false, reason: "limit", scope: "organization" });
      expect(
        refused.ok === false && refused.reason === "limit" && refused.retryAfterMs,
      ).toBeGreaterThan(0);
      expect(calls).toHaveLength(INTAKE_DAILY_LIMIT_PER_ORGANIZATION);

      // Another organization is unaffected; the same organization is allowed again after the window.
      expect((await ask(dispatcher, complete.email, { now: () => now })).ok).toBe(true);
      const nextDay = new Date(now.getTime() + 24 * 60 * 60_000 + 1000);
      expect((await ask(user, complete.email, { model, now: () => nextDay })).ok).toBe(true);
    });

    it("in demo mode one global cap applies to everyone, not the per-organization one", async () => {
      const seen: string[] = [];
      const consume = vi.fn(async (rule: { name: string }) => {
        seen.push(rule.name);
        return { limited: false as const };
      });
      await ask(dispatcher, complete.email, { demoMode: true, consume });
      await ask(dispatcher, complete.email, { demoMode: false, consume });
      expect(seen).toEqual([
        RATE_LIMITS.intakeDemoGlobal.name,
        RATE_LIMITS.intakePerOrganization.name,
      ]);
      expect(RATE_LIMITS.intakeDemoGlobal.limit).toBe(INTAKE_DAILY_LIMIT_DEMO);
    });

    it("refuses in demo mode once the global counter is spent", async () => {
      // A tiny stand-in rule on the real counters, to see the refusal without 200 requests.
      const rule = { name: `intake:demo-test-${randomUUID()}`, limit: 2, windowMs: 60_000 };
      const consume = (_rule: unknown, subject: string, now: Date) =>
        consumeRateLimit(rule, subject, now);
      const { model, calls } = countingModel();

      expect((await ask(dispatcher, complete.email, { model, demoMode: true, consume })).ok).toBe(
        true,
      );
      expect((await ask(dispatcher, complete.email, { model, demoMode: true, consume })).ok).toBe(
        true,
      );
      expect(
        await ask(dispatcher, complete.email, { model, demoMode: true, consume }),
      ).toMatchObject({
        ok: false,
        reason: "limit",
        scope: "demo",
      });
      expect(calls).toHaveLength(2);
    });

    it("counts a failed model call too: the bill follows attempts", async () => {
      const org = (await createTestOrganization()).id;
      const user = await createTestContext(org, "dispatcher");
      const failing: IntakeModel = {
        name: "failing",
        extract: () => Promise.reject(new IntakeModelError("down")),
      };
      const consume = vi.fn(async () => ({ limited: false as const }));
      expect(await ask(user, complete.email, { model: failing, consume })).toEqual({
        ok: false,
        reason: "model_failed",
      });
      expect(consume).toHaveBeenCalledTimes(1);
    });
  });

  it("reports a failing model without leaking its error or the email", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing: IntakeModel = {
      name: "failing",
      extract: ({ emailText }) => Promise.reject(new Error(`boom: ${emailText}`)),
    };
    const result = await ask(dispatcher, complete.email, { model: failing });
    expect(result).toEqual({ ok: false, reason: "model_failed" });
    expect(JSON.stringify(result)).not.toContain("Grace");
    expect(JSON.stringify(logged.mock.calls)).not.toContain("Grace");
  });
});
