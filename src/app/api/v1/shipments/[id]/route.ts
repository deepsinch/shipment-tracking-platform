import { etagOf } from "@/server/api/etag";
import { problemFromFailure } from "@/server/api/failures";
import { toApiShipmentDetail } from "@/server/api/projections";
import { apiRoute, jsonResponse } from "@/server/api/route";
import { getShipment } from "@/server/services/get-shipment";

export const GET = apiRoute<{ id: string }>("shipments:read", async ({ params, ctx }) => {
  const result = await getShipment(ctx, params.id);
  if (!result.ok) return problemFromFailure(result);

  return jsonResponse(toApiShipmentDetail(result), { etag: etagOf(result.shipment.version) });
});
