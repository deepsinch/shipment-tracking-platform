import { isCronAuthorized } from "@/server/demo/cron-auth";
import { env } from "@/server/env";
import { purgeExpiredData } from "@/server/services/purge-expired-data";
import { drainEmailBacklog } from "@/server/services/email-delivery";
import { drainBacklog } from "@/server/services/webhook-delivery";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * The daily purge of expired location pings, rate-limit rows and old finished delivery logs (plus a webhook drain, see
 * below), called by Vercel Cron (a GET with
 * `Authorization: Bearer <CRON_SECRET>`, see `vercel.json`). Unlike the demo reset it runs in any
 * deployment that has a `CRON_SECRET`; without one, or with a wrong one, it answers 401.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = env.demo.cronSecret;
  if (!secret || !isCronAuthorized(request.headers.get("authorization"), secret)) {
    return new Response(null, { status: 401 });
  }
  const purged = await purgeExpiredData();
  // The daily backstop for webhooks: retries that no activity picked up, such as the 6-hour step
  // of the backoff on a quiet night. Hobby allows daily crons only, hence the shared route.
  const webhooks = await drainBacklog();
  const emails = await drainEmailBacklog();
  return Response.json({ status: "purged", ...purged, webhooks, emails }, { headers: NO_STORE });
}
