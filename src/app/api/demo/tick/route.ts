import { getAuthContextFromHeaders } from "@/server/auth/request-context";
import { env } from "@/server/env";
import { advanceDemoSimulation } from "@/server/services/advance-demo-simulation";

/**
 * A tick drives every demo truck once: a few queries per truck. Well under a minute even over a
 * network database; the platform default would also do, but a stuck tick should not hold an
 * instance for long.
 */
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Demo mode only: advances the simulator by one tick (see `advanceDemoSimulation`). POST, because
 * it changes data. Answers 404 when demo mode is off (as if the route did not exist), 401 without
 * a session and 403 for a member of any other organization; 200 with `{ ran }` otherwise, and a
 * throttled call returns at once with `ran: false`.
 */
export async function POST(request: Request): Promise<Response> {
  // Demo mode first, so a non-demo deployment reveals nothing, not even that sign-in is needed.
  if (!env.demo.enabled) return new Response(null, { status: 404, headers: NO_STORE });

  const viewer = await getAuthContextFromHeaders(request.headers);
  if (!viewer)
    return Response.json({ error: "Sign in first." }, { status: 401, headers: NO_STORE });

  const result = await advanceDemoSimulation(viewer);
  if (!result.ok) {
    return result.reason === "demo_disabled"
      ? new Response(null, { status: 404, headers: NO_STORE })
      : Response.json({ error: "Not part of the demo." }, { status: 403, headers: NO_STORE });
  }
  return Response.json(
    result.ran
      ? { ran: true, driven: result.driven, remaining: result.remaining }
      : { ran: false, reason: result.reason },
    { headers: NO_STORE },
  );
}
