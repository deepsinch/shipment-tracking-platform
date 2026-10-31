import "server-only";

import { isAPIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/server/db/client";
import { session } from "@/server/db/schema";

import { getAuth } from "./auth";
import { resolveAuthContext, type AuthContext } from "./auth-context";
import { clearRateLimit, consumeRateLimit, RATE_LIMITS, type RateLimited } from "./rate-limit";

export const signInSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(1),
});

export type SignInResult =
  /**
   * `context` is the new session's AuthContext, so the caller can send the user to their role's
   * home. Null for a user without an organization (see "Known issues" in implementation-notes).
   */
  | { ok: true; context: AuthContext | null }
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
 * uses them to set the session cookie. That cookie only reaches the browser with the response, so
 * the new session's context is resolved from its database row rather than from request headers.
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

  let signedIn: { token: string; user: { id: string } };
  try {
    signedIn = await getAuth().api.signInEmail({
      body: { email, password },
      headers: request.headers,
    });
  } catch (error) {
    if (isAPIError(error)) return { ok: false, reason: "invalid" };
    throw error;
  }
  await clearRateLimit(RATE_LIMITS.signInPerAccount, account);
  return { ok: true, context: await contextOfSession(signedIn.token, signedIn.user.id) };
}

/** The AuthContext for a just-created session, read from the row the session hook wrote. */
async function contextOfSession(token: string, userId: string): Promise<AuthContext | null> {
  const [row] = await getDb()
    .select({ activeOrganizationId: session.activeOrganizationId })
    .from(session)
    .where(eq(session.token, token))
    .limit(1);
  return row
    ? resolveAuthContext({ userId, activeOrganizationId: row.activeOrganizationId })
    : null;
}
