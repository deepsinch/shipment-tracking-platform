import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic redirect only: sends visitors without a session cookie to sign-in before rendering.
 * It does not validate the session. The real check is `requireAuthContext()` in every protected
 * page, Server Action and service call.
 */
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    const signIn = new URL("/sign-in", request.url);
    return NextResponse.redirect(signIn);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
