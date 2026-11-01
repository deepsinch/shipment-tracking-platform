import { describe, expect, it } from "vitest";

import type { ActorRole } from "./roles";
import {
  canManageWebhooks,
  canResend,
  DELIVERY_STATUSES,
  isDeliverySuccess,
  isWebhookEventType,
  MAX_DELIVERY_ATTEMPTS,
  RETRY_DELAYS_MS,
  transitionAfterAttempt,
} from "./webhooks";

const NOW = new Date("2026-03-01T12:00:00Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe("canManageWebhooks", () => {
  const expected: Record<ActorRole, boolean> = {
    admin: true,
    dispatcher: false,
    driver: false,
    api: false,
  };
  it.each(Object.entries(expected))("%s: %s", (role, allowed) => {
    expect(canManageWebhooks(role as ActorRole)).toBe(allowed);
  });
});

describe("retry schedule", () => {
  it("is 1 minute, 5 minutes, 30 minutes, 2 hours, 6 hours, then dead", () => {
    expect(RETRY_DELAYS_MS).toEqual([MINUTE, 5 * MINUTE, 30 * MINUTE, 2 * HOUR, 6 * HOUR]);
    expect(MAX_DELIVERY_ATTEMPTS).toBe(6);
  });

  it("schedules each retry from the attempt that failed", () => {
    for (const [index, delay] of RETRY_DELAYS_MS.entries()) {
      expect(transitionAfterAttempt(index + 1, false, NOW)).toEqual({
        status: "failed",
        nextAttemptAt: new Date(NOW.getTime() + delay),
      });
    }
  });

  it("gives up after the last attempt", () => {
    expect(transitionAfterAttempt(MAX_DELIVERY_ATTEMPTS, false, NOW)).toEqual({
      status: "dead",
      nextAttemptAt: null,
    });
    expect(transitionAfterAttempt(MAX_DELIVERY_ATTEMPTS + 3, false, NOW).status).toBe("dead");
  });

  it("succeeds at any attempt", () => {
    for (let attempts = 1; attempts <= MAX_DELIVERY_ATTEMPTS; attempts++) {
      expect(transitionAfterAttempt(attempts, true, NOW)).toEqual({
        status: "succeeded",
        nextAttemptAt: null,
      });
    }
  });
});

describe("isDeliverySuccess", () => {
  it.each([
    [200, true],
    [201, true],
    [204, true],
    [299, true],
    [199, false],
    [300, false],
    [301, false],
    [302, false],
    [400, false],
    [410, false],
    [429, false],
    [500, false],
    [503, false],
    [0, false],
  ])("%i: %s", (code, expected) => expect(isDeliverySuccess(code)).toBe(expected));
});

describe("canResend", () => {
  it("only finished deliveries", () => {
    expect(Object.fromEntries(DELIVERY_STATUSES.map((s) => [s, canResend(s)]))).toEqual({
      pending: false,
      failed: false,
      succeeded: true,
      dead: true,
    });
  });
});

describe("isWebhookEventType", () => {
  it("knows the three events", () => {
    expect(isWebhookEventType("shipment.created")).toBe(true);
    expect(isWebhookEventType("shipment.deleted")).toBe(false);
    expect(isWebhookEventType(undefined)).toBe(false);
  });
});
