import { describe, expect, it } from "vitest";

import {
  deriveUnsubscribeKey,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from "./unsubscribe-token";

const key = deriveUnsubscribeKey("a-long-auth-secret-for-tests-0123456789");
const subject = { organizationId: "org_1", email: "ada@example.com" };

describe("unsubscribe tokens", () => {
  it("round-trips the organization and address", () => {
    expect(verifyUnsubscribeToken(key, signUnsubscribeToken(key, subject))).toEqual(subject);
  });

  it("is URL safe", () => {
    expect(signUnsubscribeToken(key, { organizationId: "o/?&", email: "a+b@example.com" })).toMatch(
      /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    );
  });

  it("rejects a tampered payload (another address, same signature)", () => {
    const [, sig] = signUnsubscribeToken(key, subject).split(".");
    const other = Buffer.from(JSON.stringify({ o: "org_1", e: "victim@example.com" })).toString(
      "base64url",
    );
    expect(verifyUnsubscribeToken(key, `${other}.${sig}`)).toBeNull();
  });

  it("rejects a tampered or truncated signature", () => {
    const [payload, sig] = signUnsubscribeToken(key, subject).split(".");
    expect(verifyUnsubscribeToken(key, `${payload}.${sig!.slice(0, -2)}AA`)).toBeNull();
    expect(verifyUnsubscribeToken(key, `${payload}.${sig!.slice(0, -4)}`)).toBeNull();
    expect(verifyUnsubscribeToken(key, `${payload}.`)).toBeNull();
  });

  it("rejects a token signed with another key", () => {
    const other = deriveUnsubscribeKey("a-different-auth-secret-0123456789abcdef");
    expect(verifyUnsubscribeToken(key, signUnsubscribeToken(other, subject))).toBeNull();
  });

  it.each(["", "garbage", "a.b.c", ".", "a b.c", "%00.%00"])("rejects %j", (token) => {
    expect(verifyUnsubscribeToken(key, token)).toBeNull();
  });

  it("derives a key different from the secret itself and stable per secret", () => {
    expect(deriveUnsubscribeKey("s".repeat(32)).equals(deriveUnsubscribeKey("s".repeat(32)))).toBe(
      true,
    );
    expect(deriveUnsubscribeKey("s".repeat(32)).toString()).not.toBe("s".repeat(32));
  });
});
