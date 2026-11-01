import { createShipment } from "@/server/services/create-shipment";
import { listShipments } from "@/server/services/list-shipments";
import { etagOf } from "@/server/api/etag";
import { problemFromFailure } from "@/server/api/failures";
import { CREATE_SHIPMENT_FIELDS } from "@/server/api/request-fields";
import { toApiShipment, toApiShipmentSummary } from "@/server/api/projections";
import { apiRoute, jsonResponse, readJsonObject, rejectUnknownFields } from "@/server/api/route";

export const GET = apiRoute("shipments:read", async ({ request, ctx }) => {
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const result = await listShipments(ctx, query);
  if (!result.ok) return problemFromFailure(result);

  return jsonResponse({
    data: result.rows.map(toApiShipmentSummary),
    pagination: {
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      totalPages: Math.ceil(result.total / result.pageSize),
    },
  });
});

export const POST = apiRoute("shipments:write", async ({ request, ctx }) => {
  const body = await readJsonObject(request);
  if (!body.ok) return body.response;
  const unknown = rejectUnknownFields(body.body, CREATE_SHIPMENT_FIELDS);
  if (unknown) return unknown;

  const result = await createShipment(ctx, body.body);
  if (!result.ok) return problemFromFailure(result);

  return jsonResponse(toApiShipment(result.shipment), {
    status: 201,
    etag: etagOf(result.shipment.version),
    headers: { Location: `/api/v1/shipments/${result.shipment.id}` },
  });
});
