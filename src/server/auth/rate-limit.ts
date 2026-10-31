import "server-only";

import { createHash } from "node:crypto";

import { eq, sql } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { authRateLimits } from "@/server/db/schema";

/**
 * Fixed-window rate limits for sign-in and sign-up, stored in Postgres.
 *
 * Better Auth has its own limiter, but it only covers requests through its HTTP handler; our
 * Server Actions call `auth.api.*` directly, so they need their own. Postgres (not process memory)
 * because serverless platforms run many short-lived instances: an in-memory counter would reset on
 * every cold start and be multiplied by the number of instances. One atomic upsert per attempt is
 * cheap at sign-in volumes. A fixed window is simpler than a sliding one and good enough here: at
 * worst an attacker gets 2x the limit across a window boundary.
 */

const MINUTE = 60 * 1000;

export type RateLimitRule = { name: string; limit: number; windowMs: number };

export const RATE_LIMITS = {
  /** Per email + IP: guessing one account's password. Cleared by a successful sign-in. */
  signInPerAccount: { name: "sign-in:account", limit: 5, windowMs: 15 * MINUTE },
  /** Per IP, every attempt: one client spraying many accounts. Loose for shared office IPs. */
  signInPerIp: { name: "sign-in:ip", limit: 30, windowMs: 15 * MINUTE },
  /** Per IP, every submission: mass account creation. */
  signUpPerIp: { name: "sign-up:ip", limit: 10, windowMs: 60 * MINUTE },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitStatus = { limited: false } | { limited: true; retryAfterMs: number };

/** Result shape for callers that turn a limit into a refusal. */
export type RateLimited = { ok: false; reason: "rate_limited"; retryAfterMs: number };

/** Hashed so the table never holds emails or IP addresses in clear. */
function keyFor(rule: RateLimitRule, subject: string): string {
  return createHash("sha256").update(`${rule.name}\n${subject}`).digest("hex");
}

/**
 * Counts one attempt and says whether it is over the limit. Atomic: a single upsert either starts
 * a new window or increments the current one, so concurrent attempts cannot slip past the count
 * (counting before the attempt, not after a failure, is what makes parallel guessing useless).
 */
export async function consumeRateLimit(
  rule: RateLimitRule,
  subject: string,
  now: Date = new Date(),
): Promise<RateLimitStatus> {
  const windowExpired = sql`${authRateLimits.windowStart} <= ${new Date(now.getTime() - rule.windowMs)}`;
  const [row] = await getDb()
    .insert(authRateLimits)
    .values({ key: keyFor(rule, subject), windowStart: now, count: 1 })
    .onConflictDoUpdate({
      target: authRateLimits.key,
      set: {
        windowStart: sql`CASE WHEN ${windowExpired} THEN ${now} ELSE ${authRateLimits.windowStart} END`,
        count: sql`CASE WHEN ${windowExpired} THEN 1 ELSE ${authRateLimits.count} + 1 END`,
      },
    })
    .returning();

  if (row!.count <= rule.limit) return { limited: false };
  return {
    limited: true,
    retryAfterMs: row!.windowStart.getTime() + rule.windowMs - now.getTime(),
  };
}

/** Forgets the count, e.g. after a successful sign-in. */
export async function clearRateLimit(rule: RateLimitRule, subject: string): Promise<void> {
  await getDb()
    .delete(authRateLimits)
    .where(eq(authRateLimits.key, keyFor(rule, subject)));
}

/** "Too many attempts. Try again in 12 minutes." */
export function tooManyAttemptsMessage(retryAfterMs: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterMs / MINUTE));
  return `Too many attempts. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}
