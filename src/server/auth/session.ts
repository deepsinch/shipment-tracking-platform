import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { getAuth } from "./auth";
import { resolveAuthContext, type AuthContext } from "./auth-context";

export type { AuthContext } from "./auth-context";

/**
 * The signed-in user's AuthContext, or null. Deduplicated per request with React `cache`.
 *
 * It reads request headers, so with Cache Components it must run inside a `<Suspense>` boundary
 * (a route's `loading.tsx` counts), never at the top level of a layout.
 */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  return resolveAuthContext({
    userId: session.user.id,
    activeOrganizationId: session.session.activeOrganizationId,
  });
});

/**
 * The AuthContext, or a redirect to sign-in. This is the real access check: every protected page,
 * Server Action and service entry point calls it (proxy.ts only does an optimistic cookie check).
 */
export async function requireAuthContext(): Promise<AuthContext> {
  const context = await getAuthContext();
  if (!context) redirect("/sign-in");
  return context;
}

/** Name and email for display, for the signed-in user. */
export const getCurrentUser = cache(async () => {
  const session = await getAuth().api.getSession({ headers: await headers() });
  return session ? { name: session.user.name, email: session.user.email } : null;
});
