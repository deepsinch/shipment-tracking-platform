import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The token in an email's unsubscribe link: `base64url(JSON {o: organizationId, e: email})`, a dot,
 * and `base64url(HMAC-SHA256(key, payload))`. It names whom to opt out, and the signature proves
 * the link came from us, so nobody can opt out an address by guessing a URL. Tokens do not expire
 * (an old email's link should keep working) and are not single use (opting out twice is harmless).
 */

export type UnsubscribeSubject = { organizationId: string; email: string };

/**
 * A key for these tokens derived from the app's auth secret, domain-separated so the same secret
 * never signs two kinds of thing with the same key. This avoids one more variable the owner must
 * set. The cost is that rotating the auth secret invalidates old unsubscribe links, which is
 * acceptable: rotation is rare and already signs everyone out.
 */
export function deriveUnsubscribeKey(authSecret: string): Buffer {
  return createHmac("sha256", authSecret).update("waybill:email-unsubscribe:v1").digest();
}

const encode = (value: string | Buffer) => Buffer.from(value).toString("base64url");

function signature(key: Buffer, payload: string): Buffer {
  return createHmac("sha256", key).update(payload).digest();
}

export function signUnsubscribeToken(key: Buffer, subject: UnsubscribeSubject): string {
  const payload = encode(JSON.stringify({ o: subject.organizationId, e: subject.email }));
  return `${payload}.${encode(signature(key, payload))}`;
}

/** The subject of a genuine token, or null for anything else (malformed, tampered, other key). */
export function verifyUnsubscribeToken(key: Buffer, token: string): UnsubscribeSubject | null {
  const parts = token.split(".");
  if (
    parts.length !== 2 ||
    !/^[A-Za-z0-9_-]+$/.test(parts[0]!) ||
    !/^[A-Za-z0-9_-]+$/.test(parts[1]!)
  ) {
    return null;
  }
  const [payload, received] = parts as [string, string];
  const expected = signature(key, payload);
  const given = Buffer.from(received, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  try {
    const body: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof body !== "object" || body === null) return null;
    const { o, e } = body as { o?: unknown; e?: unknown };
    return typeof o === "string" && typeof e === "string" && o && e
      ? { organizationId: o, email: e }
      : null;
  } catch {
    return null;
  }
}
