import { etagOf, parseIfMatch } from "@/server/api/etag";
import { problemFromFailure } from "@/server/api/failures";
import { problemResponse } from "@/server/api/problem";
import { CHANGE_STATUS_FIELDS } from "@/server/api/request-fields";
import { toApiShipment } from "@/server/api/projections";
import { apiRoute, jsonResponse, readJsonObject, rejectUnknownFields } from "@/server/api/route";
import { changeShipmentStatus } from "@/server/services/change-shipment-status";
import { deliverWebhooksAfterResponse } from "@/server/webhooks/schedule";

/** The service calls the target status `toStatus`; the API calls it `status`. */
const SERVICE_TO_API_FIELD = { toStatus: "status" };

/**
 * Changes a shipment's status. `If-Match` (the ETag from the last read of the shipment) is
 * required: without it an integration could act on a stale view, and the same lost-update
 * protection the dashboard's forms have would be optional here. 428 when missing, 412 when the
 * shipment has changed since (the response carries the current ETag).
 */
export const POST = apiRoute<{ id: string }>(
  "shipments:write",
  async ({ request, params, ctx }) => {
    const ifMatch = parseIfMatch(request.headers.get("if-match"));
    if (ifMatch.kind === "missing") {
      return problemResponse("precondition_required", {
        detail:
          "Send the shipment's current ETag as If-Match, from GET /shipments/{id}. " +
          "It guards against changing a shipment you have not seen the latest state of.",
      });
    }
    if (ifMatch.kind === "malformed") {
      return problemResponse("validation", {
        detail: 'If-Match must be the shipment\'s ETag, e.g. "3".',
        errors: { "If-Match": ['Use a single quoted ETag, e.g. "3"'] },
      });
    }

    const body = await readJsonObject(request);
    if (!body.ok) return body.response;
    const unknown = rejectUnknownFields(body.body, CHANGE_STATUS_FIELDS);
    if (unknown) return unknown;

    const { status, ...rest } = body.body;
    const result = await changeShipmentStatus(ctx, {
      ...rest,
      shipmentId: params.id,
      expectedVersion: ifMatch.version,
      toStatus: status,
    });
    if (!result.ok) return problemFromFailure(result, SERVICE_TO_API_FIELD);
    deliverWebhooksAfterResponse();

    return jsonResponse(toApiShipment(result.shipment), { etag: etagOf(result.shipment.version) });
  },
);
