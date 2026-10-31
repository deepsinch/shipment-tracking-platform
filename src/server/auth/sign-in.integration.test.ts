import { randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { getAuth } from "./auth";
import { RATE_LIMITS } from "./rate-limit";
import { signIn } from "./sign-in";
import { signUpFromRequest } from "./sign-up";

const PASSWORD = "correct-horse-battery";
const t0 = new Date("2026-10-31T12:00:00Z");
const minutesLater = (minutes: number) => new Date(t0.getTime() + minutes * 60 * 1000);
const fakeIp = () => `203.0.113.${Math.floor(Math.random() * 250)}-${randomUUID()}`;

describe("signIn rate limits", () => {
  let email: string;

  beforeAll(async () => {
    email = `${randomUUID()}@example.test`;
    await getAuth().api.signUpEmail({ body: { name: "Rita", email, password: PASSWORD } });
  });

  // Rita belongs to no organization, so her session has no AuthContext.
  const signedIn = { ok: true, context: null };

  const attempt = (ip: string, password: string, now = t0, who = email) =>
    signIn({ email: who, password }, { ip }, now);

  it("signs in with the right password", async () => {
    expect(await attempt(fakeIp(), PASSWORD)).toEqual(signedIn);
  });

  it("locks an account from one IP after 5 failures, even for the right password", async () => {
    const ip = fakeIp();
    for (let i = 0; i < 5; i++)
      expect(await attempt(ip, "wrong")).toEqual({ ok: false, reason: "invalid" });

    const locked = await attempt(ip, PASSWORD, minutesLater(1));
    expect(locked).toEqual({ ok: false, reason: "rate_limited", retryAfterMs: 14 * 60 * 1000 });
    // Another IP is not affected by the per-account limit.
    expect(await attempt(fakeIp(), PASSWORD, minutesLater(1))).toEqual(signedIn);
    // And the window ends.
    expect(await attempt(ip, PASSWORD, minutesLater(15))).toEqual(signedIn);
  });

  it("answers the same for an unknown email, so the limit reveals nothing", async () => {
    const ip = fakeIp();
    const unknown = `${randomUUID()}@example.test`;
    for (let i = 0; i < 5; i++) {
      expect(await attempt(ip, "wrong", t0, unknown)).toEqual({ ok: false, reason: "invalid" });
    }
    expect(await attempt(ip, "wrong", t0, unknown)).toMatchObject({ reason: "rate_limited" });
  });

  it("clears the account's failures after a successful sign-in", async () => {
    const ip = fakeIp();
    for (let i = 0; i < 4; i++) await attempt(ip, "wrong");
    expect(await attempt(ip, PASSWORD)).toEqual(signedIn);

    for (let i = 0; i < 4; i++) await attempt(ip, "wrong");
    expect(await attempt(ip, PASSWORD)).toEqual(signedIn);
  });

  it("caps attempts per IP across many accounts", async () => {
    const ip = fakeIp();
    const { limit } = RATE_LIMITS.signInPerIp;
    for (let i = 0; i < limit; i++) {
      const result = await attempt(ip, "wrong", t0, `${randomUUID()}@example.test`);
      expect(result).toEqual({ ok: false, reason: "invalid" });
    }

    expect(await attempt(ip, PASSWORD)).toMatchObject({ reason: "rate_limited" });
  });
});

describe("signIn context", () => {
  it("returns the new session's organization and role, for the role-based landing", async () => {
    const owner = await signUpFromRequest(
      {
        name: "Olga",
        email: `${randomUUID()}@example.test`,
        password: PASSWORD,
        organizationName: "Context Freight",
      },
      { ip: fakeIp() },
    );
    if (!owner.ok) throw new Error("setup failed");
    const email = `${randomUUID()}@example.test`;
    const { user } = await getAuth().api.signUpEmail({
      body: { name: "Dirk", email, password: PASSWORD },
    });
    await getAuth().api.addMember({
      body: { userId: user.id, organizationId: owner.organizationId, role: "driver" },
    });

    expect(await signIn({ email, password: PASSWORD }, { ip: fakeIp() })).toEqual({
      ok: true,
      context: { userId: user.id, organizationId: owner.organizationId, role: "driver" },
    });
  });
});

describe("signUpFromRequest rate limit", () => {
  it("refuses an IP's submissions over the hourly limit, without creating anyone", async () => {
    const ip = fakeIp();
    const { limit } = RATE_LIMITS.signUpPerIp;
    // Invalid submissions count too, and are cheap to send.
    for (let i = 0; i < limit; i++) {
      expect(await signUpFromRequest({}, { ip }, t0)).toMatchObject({ ok: false, fieldErrors: {} });
    }

    const email = `${randomUUID()}@example.test`;
    const valid = { name: "Sam", email, password: PASSWORD, organizationName: "Late Freight" };
    expect(await signUpFromRequest(valid, { ip }, minutesLater(1))).toEqual({
      ok: false,
      reason: "rate_limited",
      retryAfterMs: 59 * 60 * 1000,
    });
    expect(await signUpFromRequest(valid, { ip }, minutesLater(60))).toMatchObject({ ok: true });
  });
});
