# Waybill API

Book shipments and follow them from your own systems. The machine-readable description is the
OpenAPI 3.1 document at `/api/v1/openapi.json`. Every example below uses `$BASE` for the app's
origin (for example `https://shipment-tracking-platform-xi.vercel.app`) and `$KEY` for an API key.

## Authentication

An admin creates a key under **API keys** in the dashboard (`/dashboard/settings/api-keys`),
choosing a name and scopes. The key (`wb_live_` plus 43 characters) is shown once; Waybill stores
only a hash, so a lost key is revoked and replaced, never recovered.

```sh
curl -H "Authorization: Bearer $KEY" "$BASE/api/v1/shipments"
```

| Scope             | Allows                                  |
| ----------------- | --------------------------------------- |
| `shipments:read`  | `GET /shipments`, `GET /shipments/{id}` |
| `shipments:write` | `POST /shipments`, `POST .../status`    |

A key acts for its organization only. Other organizations' shipments do not exist for it (`404`).
`GET /tracking/{code}` is public and needs no key.

## Endpoints

| Method and path                      | Scope             | Notes                                            |
| ------------------------------------ | ----------------- | ------------------------------------------------ |
| `GET /api/v1/shipments`              | `shipments:read`  | `page`, `pageSize` (max 100), `status`, `search` |
| `GET /api/v1/shipments/{id}`         | `shipments:read`  | With history; sets `ETag`                        |
| `POST /api/v1/shipments`             | `shipments:write` | `201`, `Location` and `ETag`                     |
| `POST /api/v1/shipments/{id}/status` | `shipments:write` | Requires `If-Match`                              |
| `GET /api/v1/tracking/{code}`        | none              | What the public tracking page shows              |

```sh
# Book a shipment
curl -X POST "$BASE/api/v1/shipments" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{
    "reference": "PO-1001",
    "recipientName": "Grace Recipient",
    "originAddressLine": "Wilhelminakade 1", "originCity": "Rotterdam", "originCountry": "NL",
    "destinationAddressLine": "Meir 1", "destinationCity": "Antwerp", "destinationCountry": "BE",
    "weightKg": 12.5
  }'

# List: newest first, filter by status, search a tracking code or part of a reference
curl -H "Authorization: Bearer $KEY" "$BASE/api/v1/shipments?status=in_transit&search=PO-10&pageSize=50"
```

Unknown fields in a request body are rejected (`400`), so a misspelt optional field is noticed.
Times are ISO 8601 in UTC. Ids other than the shipment id (users, organization) are never returned.

## Changing a status: ETag and If-Match

Every response that returns a shipment carries `ETag: "<version>"`. The version changes with every
change to the shipment. A status change must name the version you based your decision on:

```sh
curl -i -H "Authorization: Bearer $KEY" "$BASE/api/v1/shipments/$ID"
# ETag: "3"

curl -X POST "$BASE/api/v1/shipments/$ID/status" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -H 'If-Match: "3"' \
  -d '{"status": "picked_up", "publicNote": "Collected", "location": {"city": "Rotterdam"}}'
# 200, ETag: "4"
```

| Situation                | Response                                                  |
| ------------------------ | --------------------------------------------------------- |
| No `If-Match`            | `428`                                                     |
| Not a single quoted ETag | `400` (weak tags, lists and `*` are not accepted)         |
| Shipment changed since   | `412`, with the current `ETag`: read, decide again, retry |
| Transition not allowed   | `409`, with `from` and `to`                               |

Two requests with the same `If-Match` can never both succeed: the second gets `412`.

## Errors

Every error is an RFC 9457 `application/problem+json` document:

```json
{
  "type": "urn:waybill:problem:validation",
  "title": "The request is not valid",
  "status": 400,
  "detail": "One or more fields are not valid.",
  "errors": { "weightKg": ["Enter a weight above 0 kg"] }
}
```

Switch on `type`; `title` and `detail` are for people.

| Status | `type` (after `urn:waybill:problem:`) | Meaning                                          |
| ------ | ------------------------------------- | ------------------------------------------------ |
| 400    | `validation`, `invalid-json`          | Bad field, header or body; `errors` names fields |
| 401    | `unauthorized`                        | Missing, malformed, unknown or revoked key       |
| 403    | `forbidden`                           | The key lacks the scope for this operation       |
| 404    | `not-found`                           | No such shipment (also for other organizations') |
| 409    | `invalid-transition`                  | The state machine forbids the change             |
| 412    | `precondition-failed`                 | `If-Match` is stale                              |
| 428    | `precondition-required`               | `If-Match` is missing                            |
| 429    | `rate-limited`                        | See `Retry-After` (seconds)                      |
| 500    | `internal`                            | Not your fault; retry later                      |

## Rate limits

Fixed one-minute windows: 120 requests per key, 30 requests with an invalid key per client address,
and 60 public tracking lookups per client address. Over the limit you get `429` with `Retry-After`.

## Not in the API

Assigning drivers, live positions and managing keys are dashboard-only. The API has no CORS headers:
call it from servers, not from browsers.
