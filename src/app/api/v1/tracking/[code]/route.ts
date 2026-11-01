import { problemFromFailure } from "@/server/api/failures";
import { toApiTracking } from "@/server/api/projections";
import { jsonResponse, publicApiRoute } from "@/server/api/route";
import { getPublicTracking } from "@/server/services/public-tracking";

/** Public tracking, like the tracking page: no key, only what the customer may see. */
export const GET = publicApiRoute<{ code: string }>(async ({ params }) => {
  const tracking = await getPublicTracking(params.code);
  if (!tracking) return problemFromFailure({ reason: "not_found" });
  return jsonResponse(toApiTracking(tracking));
});
