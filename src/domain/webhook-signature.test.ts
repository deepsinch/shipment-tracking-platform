import { describe, expect, it } from "vitest";

import {
  computeSignature,
  REPLAY_WINDOW_SECONDS,
  signatureHeader,
  verifyWebhookSignature,
} from "./webhook-signature";

const SECRET = "whsec_test_secret";
const BODY = '{"id":"evt_1","type":"shipment.created"}';
const T = 1_790_000_000;

describe("signing", () => {
  it("is HMAC-SHA256 over 't.body' in hex (a vector computed with openssl)", () => {
    // printf '%s' '1790000000.{"id":"evt_1","type":"shipment.created"}' | openssl dgst -sha256 -hmac whsec_test_secret
    expect(computeSignature(SECRET, T, BODY)).toBe(
      "d438e65534bb28f8120e27d68168b1e291fa1946705897fbf8dbe93524c543d5",
    );
  });

  it("formats the header as t=<seconds>,v1=<hex>", () => {
    expect(signatureHeader(SECRET, T, BODY)).toBe(`t=${T},v1=${computeSignature(SECRET, T, BODY)}`);
  });

  it("depends on the secret, the timestamp and every byte of the body", () => {
    const base = computeSignature(SECRET, T, BODY);
    expect(computeSignature("whsec_other", T, BODY)).not.toBe(base);
    expect(computeSignature(SECRET, T + 1, BODY)).not.toBe(base);
    expect(computeSignature(SECRET, T, `${BODY} `)).not.toBe(base);
  });
});

describe("verifyWebhookSignature (the documented recipe)", () => {
  const header = signatureHeader(SECRET, T, BODY);

  it("accepts a fresh, untampered delivery", () => {
    expect(verifyWebhookSignature(SECRET, header, BODY, T + 1)).toEqual({ valid: true });
  });

  it("accepts either of several secrets during a rotation", () => {
    expect(verifyWebhookSignature(["whsec_new", SECRET], header, BODY, T)).toEqual({ valid: true });
  });

  it("rejects a tampered body", () => {
    expect(verifyWebhookSignature(SECRET, header, `${BODY}x`, T)).toEqual({
      valid: false,
      reason: "mismatch",
    });
  });

  it("rejects the wrong secret", () => {
    expect(verifyWebhookSignature("whsec_wrong", header, BODY, T)).toEqual({
      valid: false,
      reason: "mismatch",
    });
  });

  it("rejects a replay outside the 5 minute window, in either direction", () => {
    expect(REPLAY_WINDOW_SECONDS).toBe(300);
    expect(verifyWebhookSignature(SECRET, header, BODY, T + 300)).toEqual({ valid: true });
    expect(verifyWebhookSignature(SECRET, header, BODY, T + 301)).toEqual({
      valid: false,
      reason: "outside_window",
    });
    expect(verifyWebhookSignature(SECRET, header, BODY, T - 301)).toEqual({
      valid: false,
      reason: "outside_window",
    });
  });

  it("does not let an attacker move the timestamp: it is signed", () => {
    const forged = header.replace(`t=${T}`, `t=${T + 1000}`);
    expect(verifyWebhookSignature(SECRET, forged, BODY, T + 1000)).toEqual({
      valid: false,
      reason: "mismatch",
    });
  });

  it.each([null, "", "garbage", "t=abc,v1=00", `t=${T}`, `v1=${"0".repeat(64)}`, `t=${T},v1=xyz`])(
    "calls %j malformed",
    (bad) => {
      expect(verifyWebhookSignature(SECRET, bad, BODY, T)).toEqual({
        valid: false,
        reason: "malformed",
      });
    },
  );
});
