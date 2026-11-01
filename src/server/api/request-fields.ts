import { createShipmentSchema } from "@/server/services/create-shipment";

/**
 * The fields the API accepts in request bodies (anything else is a 400, see `rejectUnknownFields`).
 * Kept out of the route files, which may only export handlers, so the OpenAPI test can compare
 * them with the document.
 *
 * `assignedDriverId` is a user id, which the API neither returns nor accepts: integrations book
 * shipments, dispatchers assign drivers in the dashboard.
 */
export const CREATE_SHIPMENT_FIELDS: readonly string[] = Object.keys(
  createShipmentSchema.shape,
).filter((field) => field !== "assignedDriverId");

export const CHANGE_STATUS_FIELDS: readonly string[] = [
  "status",
  "occurredAt",
  "publicNote",
  "internalNote",
  "location",
];
