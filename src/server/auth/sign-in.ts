import "server-only";

import { isAPIError } from "better-auth/api";
import { z } from "zod";

import { getAuth } from "./auth";
import { clearRateLimit, consumeRateLimit, RATE_LIMITS, type RateLimited } from "./rate-limit";

export const signInSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(1),
});

export type SignInResult =
  | { ok: true }
  /** Malformed input, unknown email and wrong password all look the same to the caller. */
  | { ok: false; reason: "invalid" }
  | RateLimited;

/**
 * Email/password sign-in with rate limits (see `RATE_LIMITS`). The attempt is counted before
 * Better Auth checks the password, so the answer is the same whether or not the email exists, and
 * parallel requests cannot outrun the counter. A successful sign-in clears the per-account count;
 * the looser per-IP count keeps every attempt until its window ends.
 *
 * `headers` are the incoming request's: inside a Server Action, Better Auth's `nextCookies` plugin
 * uses them to set the session cookie.
 */
export async function signIn(
  input: unknown,
  request: { ip: string; headers?: Headers },
  now: Date = new Date(),
): Promise<SignInResult> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const { email, password } = parsed.data;
  const account = `${email}\n${request.ip}`;

  const statuses = await Promise.all([
    consumeRateLimit(RATE_LIMITS.signInPerAccount, account, now),
    consumeRateLimit(RATE_LIMITS.signInPerIp, request.ip, now),
  ]);
  const retryAfterMs = Math.max(
    0,
    ...statuses.map((status) => (status.limited ? status.retryAfterMs : 0)),
  );
  if (retryAfterMs > 0) return { ok: false, reason: "rate_limited", retryAfterMs };

  try {
    await getAuth().api.signInEmail({ body: { email, password }, headers: request.headers });
  } catch (error) {
    if (isAPIError(error)) return { ok: false, reason: "invalid" };
    throw error;
  }
  await clearRateLimit(RATE_LIMITS.signInPerAccount, account);
  return { ok: true };
}
