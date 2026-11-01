import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Whether an `Authorization` header is `Bearer <secret>`, the form Vercel Cron sends when the
 * project has a `CRON_SECRET`. Both sides are hashed first, so the comparison takes the same time
 * whatever the header holds and `timingSafeEqual` always gets two buffers of equal length (it
 * throws otherwise, and a length check would leak the secret's length).
 */
export function isCronAuthorized(authorization: string | null, secret: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(authorization ?? ""), digest(`Bearer ${secret}`));
}
