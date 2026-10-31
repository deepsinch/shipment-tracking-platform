import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { clearRateLimit, consumeRateLimit, tooManyAttemptsMessage } from "./rate-limit";

const rule = { name: "test", limit: 3, windowMs: 10 * 60 * 1000 };
const t0 = new Date("2026-10-31T12:00:00Z");
const at = (minutes: number) => new Date(t0.getTime() + minutes * 60 * 1000);

describe("consumeRateLimit", () => {
  it("allows the limit, then refuses with the time left in the window", async () => {
    const subject = randomUUID();
    for (let i = 0; i < 3; i++) {
      expect(await consumeRateLimit(rule, subject, at(i))).toEqual({ limited: false });
    }

    expect(await consumeRateLimit(rule, subject, at(4))).toEqual({
      limited: true,
      retryAfterMs: 6 * 60 * 1000,
    });
  });

  it("starts a new window once the old one has passed", async () => {
    const subject = randomUUID();
    for (let i = 0; i < 4; i++) await consumeRateLimit(rule, subject, at(0));

    expect(await consumeRateLimit(rule, subject, at(10))).toEqual({ limited: false });
    expect(await consumeRateLimit(rule, subject, at(11))).toEqual({ limited: false });
  });

  it("counts each subject separately, and forgets a cleared one", async () => {
    const subject = randomUUID();
    for (let i = 0; i < 4; i++) await consumeRateLimit(rule, subject, at(0));

    expect(await consumeRateLimit(rule, randomUUID(), at(1))).toEqual({ limited: false });
    await clearRateLimit(rule, subject);
    expect(await consumeRateLimit(rule, subject, at(1))).toEqual({ limited: false });
  });

  it("counts concurrent attempts exactly", async () => {
    const subject = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => consumeRateLimit(rule, subject, at(0))),
    );

    expect(results.filter((result) => !result.limited)).toHaveLength(3);
  });
});

describe("tooManyAttemptsMessage", () => {
  it("rounds up to whole minutes", () => {
    expect(tooManyAttemptsMessage(30_000)).toBe("Too many attempts. Try again in 1 minute.");
    expect(tooManyAttemptsMessage(11.5 * 60_000)).toBe(
      "Too many attempts. Try again in 12 minutes.",
    );
  });
});
