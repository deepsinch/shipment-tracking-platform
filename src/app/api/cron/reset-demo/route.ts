import { isCronAuthorized } from "@/server/demo/cron-auth";
import { resetDemo } from "@/server/demo/reset-demo";
import { env } from "@/server/env";

/**
 * Wiping, migrating and seeding takes well under a minute on a nearby database; this is the
 * Hobby/Fluid ceiling (see docs/architecture.md, "Hosting the realtime path"), so a slow network
 * database cannot cut the reset off halfway.
 */
export const maxDuration = 300;

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * The nightly demo reset, called by Vercel Cron (a GET with `Authorization: Bearer <CRON_SECRET>`,
 * see `vercel.json`). Answers 404 unless demo mode is on, as if the route did not exist, and 401
 * unless the secret matches (compared in constant time); neither says anything more.
 */
export async function GET(request: Request): Promise<Response> {
  const demo = env.demo;
  if (!demo.enabled || !demo.cronSecret) return new Response(null, { status: 404 });
  if (!isCronAuthorized(request.headers.get("authorization"), demo.cronSecret)) {
    return new Response(null, { status: 401 });
  }

  const result = await resetDemo();
  if (!result.ok) {
    // The detail (which database, which setting) goes to the logs, not to the caller.
    console.error(`Demo reset refused: ${"message" in result ? result.message : result.reason}`);
    return new Response("The demo reset was refused. See the function logs.", {
      status: 500,
      headers: NO_STORE,
    });
  }
  return Response.json(
    { status: "reset", shipmentCount: result.shipmentCount },
    { headers: NO_STORE },
  );
}
