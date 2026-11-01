import { getAuthContextFromHeaders } from "@/server/auth/request-context";
import { env } from "@/server/env";
import { getRealtimeBus } from "@/server/realtime";
import { createRealtimeStream, SSE_HEADERS, streamLifetimeMs } from "@/server/realtime/sse-stream";

/**
 * The function time limit we ask the platform for, in seconds (a literal: Next reads it at build
 * time). 300 s is the default ceiling on Vercel with Fluid compute. The stream closes itself
 * earlier (`streamLifetimeMs`, 270 s by default) and the browser reconnects, so the platform
 * never cuts a stream off mid-event.
 */
export const maxDuration = 300;

/**
 * Live invalidation signals for the signed-in user, as Server-Sent Events (see
 * `createRealtimeStream`). An API endpoint answers 401 instead of redirecting to sign-in:
 * `EventSource` would follow a redirect to an HTML page and fail without a reason.
 */
export async function GET(request: Request): Promise<Response> {
  const viewer = await getAuthContextFromHeaders(request.headers);
  if (!viewer) {
    return new Response("Sign in to receive live updates.", {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const stream = createRealtimeStream({
    viewer,
    bus: getRealtimeBus(),
    signal: request.signal,
    lifetimeMs: streamLifetimeMs(env.realtime.streamSeconds),
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
