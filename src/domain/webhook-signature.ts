import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Webhook signatures. The header is `Waybill-Signature: t=<unix seconds>,v1=<hex>`, where `v1` is
 * HMAC-SHA256 over `"<t>.<raw body>"` keyed with the endpoint's secret (the whole `whsec_...`
 * string, as text). Signing the timestamp together with the body lets a receiver reject old
 * deliveries (replay window) without trusting a separate, unsigned header. `docs/api.md` gives
 * receivers the same recipe as a Node snippet; `verifyWebhookSignature` below is that recipe, kept
 * under test so the documentation cannot drift from the code.
 */

export const SIGNATURE_HEADER = "Waybill-Signature";

/** Receivers should refuse a delivery whose timestamp is further than this from their clock. */
export const REPLAY_WINDOW_SECONDS = 5 * 60;

export function computeSignature(secret: string, timestampSeconds: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestampSeconds}.${body}`).digest("hex");
}

export function signatureHeader(secret: string, timestampSeconds: number, body: string): string {
  return `t=${timestampSeconds},v1=${computeSignature(secret, timestampSeconds, body)}`;
}

export type SignatureCheck =
  { valid: true } | { valid: false; reason: "malformed" | "outside_window" | "mismatch" };

/**
 * Verifies a `Waybill-Signature` header against the raw request body (the exact bytes received,
 * before any JSON parsing). The comparison is constant time. During secret rotation a receiver
 * may pass several candidate secrets.
 */
export function verifyWebhookSignature(
  secrets: string | readonly string[],
  header: string | null,
  body: string,
  nowSeconds: number,
  toleranceSeconds: number = REPLAY_WINDOW_SECONDS,
): SignatureCheck {
  const parts = new Map<string, string>();
  for (const part of (header ?? "").split(",")) {
    const separator = part.indexOf("=");
    if (separator > 0) parts.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
  }
  const timestamp = Number(parts.get("t"));
  const signature = parts.get("v1");
  if (!Number.isInteger(timestamp) || !signature || !/^[0-9a-f]{64}$/.test(signature)) {
    return { valid: false, reason: "malformed" };
  }
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    return { valid: false, reason: "outside_window" };
  }

  const received = Buffer.from(signature, "hex");
  const matches = (Array.isArray(secrets) ? secrets : [secrets as string]).some((secret) =>
    timingSafeEqual(Buffer.from(computeSignature(secret, timestamp, body), "hex"), received),
  );
  return matches ? { valid: true } : { valid: false, reason: "mismatch" };
}
