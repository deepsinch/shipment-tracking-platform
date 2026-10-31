import "server-only";

import { getAuth } from "./auth";
import { resolveAuthContext, type AuthContext } from "./auth-context";

/**
 * The AuthContext for a request's headers (its session cookie), or null when there is no valid
 * session or no active membership.
 *
 * `getAuthContext()` in `session.ts` calls this with `headers()` for pages and Server Actions.
 * Route handlers call it with `request.headers` directly, which also lets tests invoke them with
 * a constructed `Request`, outside Next's request scope.
 */
export async function getAuthContextFromHeaders(headers: Headers): Promise<AuthContext | null> {
  const session = await getAuth().api.getSession({ headers });
  if (!session) return null;
  return resolveAuthContext({
    userId: session.user.id,
    activeOrganizationId: session.session.activeOrganizationId,
  });
}
