import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { homePathFor, type HomePath } from "@/domain/role-home";

import { getAuth } from "./auth";
import type { MemberAuthContext } from "./auth-context";
import { getAuthContextFromHeaders } from "./request-context";

export type { AuthContext, MemberAuthContext } from "./auth-context";

/**
 * The signed-in user's context (a member role, never `api`), or null. Deduplicated per request with React `cache`.
 *
 * It reads request headers, so with Cache Components it must run inside a `<Suspense>` boundary
 * (a route's `loading.tsx` counts), never at the top level of a layout.
 */
export const getAuthContext = cache(async (): Promise<MemberAuthContext | null> =>
  getAuthContextFromHeaders(await headers()),
);

/**
 * The AuthContext, or a redirect to sign-in. This is the real access check: every protected page,
 * Server Action and service entry point calls it (proxy.ts only does an optimistic cookie check).
 */
export async function requireAuthContext(): Promise<MemberAuthContext> {
  const context = await getAuthContext();
  if (!context) redirect("/sign-in");
  return context;
}

/**
 * `requireAuthContext()` for one surface (`/dashboard` for staff, `/driver` for drivers): anyone
 * whose role works elsewhere is redirected to their own home. Layouts and pages of each surface
 * call it; services still enforce what each role may see and do.
 */
export async function requireAuthContextOn(surface: HomePath): Promise<MemberAuthContext> {
  const context = await requireAuthContext();
  const home = homePathFor(context.role);
  if (home !== surface) redirect(home);
  return context;
}

/** Name and email for display, for the signed-in user. */
export const getCurrentUser = cache(async () => {
  const session = await getAuth().api.getSession({ headers: await headers() });
  return session ? { name: session.user.name, email: session.user.email } : null;
});
