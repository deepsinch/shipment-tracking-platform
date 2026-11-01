import type { ShipmentStatus } from "@/domain/shipment-status";
import type { Shipment } from "@/server/db/schema";
import type { FieldErrors } from "@/server/services/results";

import { etagOf } from "./etag";
import { problemResponse } from "./problem";

/** The expected ways a shipment service call fails (`ok: false`), as the services report them. */
export type ServiceFailure =
  | { reason: "validation"; fieldErrors: FieldErrors }
  | { reason: "not_found" }
  | { reason: "forbidden" }
  | { reason: "invalid_transition"; from: ShipmentStatus; to: ShipmentStatus }
  | { reason: "conflict"; current: Shipment };

/**
 * Maps a service result kind to its problem response. The `switch` is exhaustive: a new result
 * kind is a type error here until someone decides its HTTP status.
 *
 * `fieldNames` renames service field names to the API's (the status change calls its target
 * `toStatus` internally and `status` in the API).
 */
export function problemFromFailure(
  failure: ServiceFailure,
  fieldNames: Readonly<Record<string, string>> = {},
): Response {
  switch (failure.reason) {
    case "validation": {
      const errors = Object.fromEntries(
        Object.entries(failure.fieldErrors).map(([field, messages]) => [
          fieldNames[field] ?? field,
          messages,
        ]),
      );
      return problemResponse("validation", {
        detail: "One or more fields are not valid.",
        errors,
      });
    }
    case "not_found":
      return problemResponse("not_found", { detail: "No such shipment." });
    case "forbidden":
      return problemResponse("forbidden", { detail: "This key may not do that." });
    case "invalid_transition":
      return problemResponse("invalid_transition", {
        detail: `A shipment cannot go from "${failure.from}" to "${failure.to}".`,
        extensions: { from: failure.from, to: failure.to },
      });
    case "conflict":
      // The fresh ETag lets the client re-read, decide again and retry.
      return problemResponse("precondition_failed", {
        detail: "The shipment changed since you read it. Fetch it again, then retry.",
        headers: { ETag: etagOf(failure.current.version) },
      });
  }
}
