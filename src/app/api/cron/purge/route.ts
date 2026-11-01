import { isCronAuthorized } from "@/server/demo/cron-auth";
import { env } from "@/server/env";
import { purgeExpiredData } from "@/server/services/purge-expired-data";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * The daily purge of expired location pings and rate-limit rows, called by Vercel Cron (a GET with
 * `Authorization: Bearer <CRON_SECRET>`, see `vercel.json`). Unlike the demo reset it runs in any
 * deployment that has a `CRON_SECRET`; without one, or with a wrong one, it answers 401.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = env.demo.cronSecret;
  if (!secret || !isCronAuthorized(request.headers.get("authorization"), secret)) {
    return new Response(null, { status: 401 });
  }
  const purged = await purgeExpiredData();
  return Response.json({ status: "purged", ...purged }, { headers: NO_STORE });
}
