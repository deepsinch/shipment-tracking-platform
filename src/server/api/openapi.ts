import { SERVICE_LEVELS } from "@/domain/service-level";
import { SHIPMENT_EVENT_TYPES, PUBLIC_SHIPMENT_EVENT_TYPES } from "@/domain/shipment-event";
import { SHIPMENT_STATUSES } from "@/domain/shipment-status";

/**
 * The OpenAPI 3.1 description of `/api/v1`, served at `/api/v1/openapi.json`.
 *
 * Hand-written, not generated from the Zod schemas, on purpose: the services' schemas are form
 * schemas (they coerce strings, trim, preprocess blanks), and a generator would publish those
 * quirks as the contract. The API's contract is what the route handlers and projections do. The
 * risk of a hand-written document is drift, so `openapi.test.ts` guards it: every route file has an
 * operation, every `$ref` resolves, and each response schema lists exactly the keys of its
 * projection. Enums come from the domain constants.
 */

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const problem = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: ref("Problem") } },
});
const problemResponses = (...statuses: string[]) =>
  Object.fromEntries(
    statuses.map((status) => [status, { $ref: `#/components/responses/${PROBLEM_NAMES[status]}` }]),
  );

const PROBLEM_NAMES: Record<string, string> = {
  "400": "ValidationProblem",
  "401": "Unauthorized",
  "403": "Forbidden",
  "404": "NotFound",
  "409": "InvalidTransition",
  "412": "PreconditionFailed",
  "428": "PreconditionRequired",
  "429": "RateLimited",
};

const nullable = (schema: object) => ({ anyOf: [schema, { type: "null" }] });
const nullableString = nullable({ type: "string" });
const dateTime = { type: "string", format: "date-time" };
const nullableDateTime = nullable(dateTime);
const nullableNumber = nullable({ type: "number" });
const etagHeader = {
  ETag: {
    description:
      'The shipment\'s version, e.g. `"3"`. Send it back as `If-Match` to change the shipment.',
    schema: { type: "string" },
  },
};
const security = [{ ApiKey: [] }];
const authErrors = ["401", "403", "429"];

const address = (extra: object = {}) => ({
  type: "object",
  required: ["addressLine", "city", "postalCode", "country", "lat", "lng"],
  properties: {
    addressLine: { type: "string" },
    city: { type: "string" },
    postalCode: nullableString,
    country: { type: "string", description: "ISO 3166-1 alpha-2.", examples: ["NL"] },
    lat: nullableNumber,
    lng: nullableNumber,
  },
  additionalProperties: false,
  ...extra,
});

const place = {
  type: "object",
  required: ["city", "country"],
  properties: { city: { type: "string" }, country: { type: "string" } },
  additionalProperties: false,
};

const object = (
  properties: Record<string, object>,
  required: string[] = Object.keys(properties),
) => ({
  type: "object",
  required,
  properties,
  additionalProperties: false,
});

const idParameter = {
  name: "id",
  in: "path",
  required: true,
  description: "The shipment id.",
  schema: { type: "string", format: "uuid" },
};

const schemas = {
  Problem: {
    type: "object",
    description: "RFC 9457 problem details.",
    required: ["type", "title", "status"],
    properties: {
      type: { type: "string", description: "A stable identifier of the kind of problem." },
      title: { type: "string" },
      status: { type: "integer" },
      detail: { type: "string" },
      errors: {
        type: "object",
        description: "Validation messages by field path.",
        additionalProperties: { type: "array", items: { type: "string" } },
      },
      from: {
        type: "string",
        enum: [...SHIPMENT_STATUSES],
        description: "Invalid transition only.",
      },
      to: { type: "string", enum: [...SHIPMENT_STATUSES], description: "Invalid transition only." },
    },
  },
  ShipmentStatus: { type: "string", enum: [...SHIPMENT_STATUSES] },
  ServiceLevel: { type: "string", enum: [...SERVICE_LEVELS] },
  ShipmentSummary: object({
    id: { type: "string", format: "uuid" },
    trackingCode: { type: "string", examples: ["WB-7K3M-Q9TX"] },
    status: ref("ShipmentStatus"),
    reference: nullableString,
    recipientName: { type: "string" },
    origin: place,
    destination: place,
    serviceLevel: ref("ServiceLevel"),
    promisedDeliveryAt: nullableDateTime,
    createdAt: dateTime,
  }),
  Pagination: object({
    page: { type: "integer", minimum: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 100 },
    total: { type: "integer", description: "Matching shipments across all pages." },
    totalPages: { type: "integer" },
  }),
  ShipmentList: object({
    data: { type: "array", items: ref("ShipmentSummary") },
    pagination: ref("Pagination"),
  }),
  Shipment: object({
    id: { type: "string", format: "uuid" },
    trackingCode: { type: "string" },
    status: ref("ShipmentStatus"),
    reference: nullableString,
    recipient: object({ name: { type: "string" }, email: nullableString }),
    origin: address(),
    destination: address(),
    weightKg: { type: "number" },
    serviceLevel: ref("ServiceLevel"),
    promisedDeliveryAt: nullableDateTime,
    createdAt: dateTime,
    updatedAt: dateTime,
  }),
  Event: object({
    type: { type: "string", enum: [...SHIPMENT_EVENT_TYPES] },
    fromStatus: nullable(ref("ShipmentStatus")),
    toStatus: nullable(ref("ShipmentStatus")),
    occurredAt: { ...dateTime, description: "When it happened in the real world." },
    recordedAt: { ...dateTime, description: "When the server stored it." },
    location: nullable(object({ city: nullableString, lat: nullableNumber, lng: nullableNumber })),
    publicNote: { ...nullableString, description: "Shown to the customer." },
    internalNote: { ...nullableString, description: "Visible to your organization only." },
    assignment: nullable(object({ from: nullableString, to: nullableString })),
  }),
  ShipmentDetail: {
    allOf: [
      ref("Shipment"),
      object({
        driverName: {
          ...nullableString,
          description: "The assigned driver's name; null when unassigned.",
        },
        events: { type: "array", description: "Oldest first.", items: ref("Event") },
      }),
    ],
    // `additionalProperties: false` cannot span `allOf`, so the combined key set is checked by tests.
    unevaluatedProperties: false,
  },
  CreateShipment: {
    type: "object",
    required: [
      "recipientName",
      "originAddressLine",
      "originCity",
      "originCountry",
      "destinationAddressLine",
      "destinationCity",
      "destinationCountry",
      "weightKg",
    ],
    properties: {
      reference: {
        type: "string",
        maxLength: 100,
        description: "Your order or PO number; searchable.",
      },
      recipientName: { type: "string", maxLength: 200 },
      recipientEmail: { type: "string", format: "email" },
      originAddressLine: { type: "string", maxLength: 200 },
      originCity: { type: "string", maxLength: 100 },
      originPostalCode: { type: "string", maxLength: 20 },
      originCountry: { type: "string", pattern: "^[A-Za-z]{2}$", examples: ["NL"] },
      originLat: { type: "number", minimum: -90, maximum: 90 },
      originLng: { type: "number", minimum: -180, maximum: 180 },
      destinationAddressLine: { type: "string", maxLength: 200 },
      destinationCity: { type: "string", maxLength: 100 },
      destinationPostalCode: { type: "string", maxLength: 20 },
      destinationCountry: { type: "string", pattern: "^[A-Za-z]{2}$", examples: ["BE"] },
      destinationLat: { type: "number", minimum: -90, maximum: 90 },
      destinationLng: { type: "number", minimum: -180, maximum: 180 },
      weightKg: { type: "number", exclusiveMinimum: 0, maximum: 100000 },
      serviceLevel: ref("ServiceLevel"),
      promisedDeliveryAt: { ...dateTime, description: "UTC." },
    },
    additionalProperties: false,
  },
  ChangeStatus: {
    type: "object",
    required: ["status"],
    properties: {
      status: ref("ShipmentStatus"),
      occurredAt: {
        ...dateTime,
        description: "When it happened; defaults to now. May be in the past, never in the future.",
      },
      publicNote: { type: "string", maxLength: 500, description: "Shown to the customer." },
      internalNote: { type: "string", maxLength: 1000 },
      location: {
        type: "object",
        properties: {
          city: { type: "string", maxLength: 100 },
          lat: { type: "number", minimum: -90, maximum: 90 },
          lng: { type: "number", minimum: -180, maximum: 180 },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  },
  Tracking: object({
    trackingCode: { type: "string" },
    status: ref("ShipmentStatus"),
    origin: place,
    destination: place,
    promisedDeliveryAt: nullableDateTime,
    timeline: {
      type: "array",
      items: object({
        type: { type: "string", enum: [...PUBLIC_SHIPMENT_EVENT_TYPES] },
        status: nullable(ref("ShipmentStatus")),
        occurredAt: dateTime,
        city: nullableString,
        publicNote: nullableString,
      }),
    },
  }),
};

const responses = {
  ValidationProblem: problem("A field or header is not valid. `errors` names the fields."),
  Unauthorized: {
    ...problem("The API key is missing, malformed, unknown or revoked."),
    headers: { "WWW-Authenticate": { schema: { type: "string" } } },
  },
  Forbidden: problem("The key lacks the scope this operation needs."),
  NotFound: problem("No such shipment (also for shipments of other organizations)."),
  InvalidTransition: problem("The state machine does not allow this status change."),
  PreconditionFailed: {
    ...problem(
      "`If-Match` does not match: the shipment changed. The current `ETag` is in the response.",
    ),
    headers: etagHeader,
  },
  PreconditionRequired: problem("The `If-Match` header is required."),
  RateLimited: {
    ...problem("Too many requests."),
    headers: {
      "Retry-After": { description: "Seconds to wait.", schema: { type: "integer" } },
    },
  },
};

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Waybill API",
    version: "1.0.0",
    description:
      "Create and follow shipments from your own systems. Authenticate with an API key " +
      "(`Authorization: Bearer wb_live_...`) created by an admin under Settings > API keys. " +
      "Errors are RFC 9457 problem details (`application/problem+json`). Times are ISO 8601 in UTC.",
  },
  servers: [{ url: "/api/v1" }],
  security,
  tags: [{ name: "Shipments" }, { name: "Tracking" }],
  paths: {
    "/shipments": {
      get: {
        operationId: "listShipments",
        tags: ["Shipments"],
        summary: "List shipments, newest first",
        description: "Requires the `shipments:read` scope.",
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
          {
            name: "pageSize",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          },
          { name: "status", in: "query", schema: ref("ShipmentStatus") },
          {
            name: "search",
            in: "query",
            description:
              "A tracking code (any case, with or without dashes) or part of a reference.",
            schema: { type: "string", maxLength: 100 },
          },
        ],
        responses: {
          "200": {
            description: "A page of shipments.",
            content: { "application/json": { schema: ref("ShipmentList") } },
          },
          ...problemResponses("400", ...authErrors),
        },
      },
      post: {
        operationId: "createShipment",
        tags: ["Shipments"],
        summary: "Book a shipment",
        description: "Requires the `shipments:write` scope. The tracking code is generated.",
        requestBody: {
          required: true,
          content: { "application/json": { schema: ref("CreateShipment") } },
        },
        responses: {
          "201": {
            description: "The new shipment.",
            headers: {
              ...etagHeader,
              Location: { schema: { type: "string" } },
            },
            content: { "application/json": { schema: ref("Shipment") } },
          },
          ...problemResponses("400", ...authErrors),
        },
      },
    },
    "/shipments/{id}": {
      get: {
        operationId: "getShipment",
        tags: ["Shipments"],
        summary: "Read a shipment with its history",
        description: "Requires the `shipments:read` scope.",
        parameters: [idParameter],
        responses: {
          "200": {
            description: "The shipment. Its `ETag` is the version to send as `If-Match`.",
            headers: etagHeader,
            content: { "application/json": { schema: ref("ShipmentDetail") } },
          },
          ...problemResponses("404", ...authErrors),
        },
      },
    },
    "/shipments/{id}/status": {
      post: {
        operationId: "changeShipmentStatus",
        tags: ["Shipments"],
        summary: "Change a shipment's status",
        description:
          "Requires the `shipments:write` scope and `If-Match` with the shipment's current ETag.",
        parameters: [
          idParameter,
          {
            name: "If-Match",
            in: "header",
            required: true,
            description: 'The ETag from the last read, e.g. `"3"`.',
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: ref("ChangeStatus") } },
        },
        responses: {
          "200": {
            description: "The updated shipment, with its new `ETag`.",
            headers: etagHeader,
            content: { "application/json": { schema: ref("Shipment") } },
          },
          ...problemResponses("400", "404", "409", "412", "428", ...authErrors),
        },
      },
    },
    "/tracking/{code}": {
      get: {
        operationId: "getTracking",
        tags: ["Tracking"],
        summary: "Public tracking",
        description:
          "What the public tracking page shows. No API key; limited per client IP. " +
          "No addresses, notes for staff, drivers or internal ids.",
        security: [],
        parameters: [
          {
            name: "code",
            in: "path",
            required: true,
            description: "A tracking code, in any case, with or without dashes.",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "The shipment's public status and timeline.",
            content: { "application/json": { schema: ref("Tracking") } },
          },
          ...problemResponses("404", "429"),
        },
      },
    },
  },
  components: {
    securitySchemes: {
      ApiKey: {
        type: "http",
        scheme: "bearer",
        description: "An API key: `wb_live_` followed by 43 characters.",
      },
    },
    schemas,
    responses,
  },
} as const;
