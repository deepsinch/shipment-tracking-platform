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

## Webhooks

Webhooks send an HTTPS `POST` to your URL when something happens, so you do not have to poll. An
admin adds one under **Webhooks** in the dashboard (`/dashboard/settings/webhooks`): the URL and the
events it wants. The signing secret (`whsec_` plus 43 characters) is shown once; lose it and you
rotate it there (the old one stops signing at once).

### Events

| `type`                     | When                                      | `data` besides `shipment` and `version`                                    |
| -------------------------- | ----------------------------------------- | -------------------------------------------------------------------------- |
| `shipment.created`         | A shipment was booked (dashboard or API)  | none                                                                       |
| `shipment.status_changed`  | A shipment moved to a new status          | `change`: `fromStatus`, `toStatus`, `occurredAt`, `location`, `publicNote` |
| `shipment.driver_assigned` | A driver was assigned, changed or removed | `assignment`: `fromDriverName`, `toDriverName`                             |

```json
{
  "id": "0b6f7a52-4c63-4c0e-9d0b-2f1f6c1c8a10",
  "type": "shipment.status_changed",
  "createdAt": "2026-03-01T10:00:00.000Z",
  "data": {
    "version": 2,
    "shipment": {
      "id": "...",
      "trackingCode": "WB-ABCD-1234",
      "status": "picked_up",
      "...": "..."
    },
    "change": {
      "fromStatus": "created",
      "toStatus": "picked_up",
      "occurredAt": "2026-03-01T10:00:00.000Z",
      "location": { "city": "Rotterdam", "lat": null, "lng": null },
      "publicNote": "Collected"
    }
  }
}
```

`data.shipment` is exactly what `GET /shipments/{id}` returns for the shipment (without its
history). As in the API, no user or organization ids are sent; drivers appear by display name.
Internal notes are never sent. `data.version` is the shipment's `ETag` number, so you can ignore a
delivery older than one you have already processed.

### Delivery

Each request has these headers:

| Header              | Value                                                         |
| ------------------- | ------------------------------------------------------------- |
| `Waybill-Event`     | The event type, e.g. `shipment.status_changed`                |
| `Waybill-Delivery`  | The delivery's id (a retry keeps it; a resend gets a new one) |
| `Waybill-Signature` | `t=<unix seconds>,v1=<hex HMAC-SHA256>`                       |
| `Content-Type`      | `application/json`                                            |

- **Success is any `2xx`**, within 5 seconds. Answer fast and do the work afterwards. Redirects are
  **not followed** (a `3xx` counts as a failure), and only the status code is read from your answer.
- **Retries:** after a failure Waybill tries again after 1 minute, 5 minutes, 30 minutes, 2 hours and
  6 hours, then gives up (six attempts in about nine hours; each retry needs some activity in the
  app or the daily job to run it, so a retry can be later than scheduled, never earlier). Five
  deliveries in a row that gave up switch the webhook off; an admin enables it again.
- **At least once.** A delivery can arrive twice (your `2xx` was lost, or an admin pressed Resend).
  Deduplicate on the event `id`: every delivery of one event, retries and resends included, carries
  the same one.
- **Order is not guaranteed.** Use `data.version` to ignore stale shipments.
- The URL must be `https` and resolve to a public address. Addresses in private, loopback,
  link-local, shared (CGNAT), multicast and cloud-metadata ranges are refused at every delivery, not
  only when you save the URL.

### Verifying the signature

Sign-check every request before trusting it. The signature covers the timestamp and the **raw body**
(the exact bytes, before any JSON parsing), keyed with the webhook's secret:

```
signed payload = "<t>.<raw body>"
v1             = hex( HMAC-SHA256( secret, signed payload ) )
```

Reject the request if the signature does not match, or if `t` is more than **5 minutes** from your
clock (a replay of an old delivery). A Node.js receiver (Express shown; the point is `express.raw`,
so the body is not parsed first):

```js
import crypto from "node:crypto";
import express from "express";

const SECRET = process.env.WAYBILL_WEBHOOK_SECRET; // "whsec_..."
const TOLERANCE_SECONDS = 5 * 60;

function verify(header, rawBody) {
  const parts = Object.fromEntries(header.split(",").map((part) => part.split("=")));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - t) > TOLERANCE_SECONDS) return false;

  const expected = crypto.createHmac("sha256", SECRET).update(`${t}.${rawBody}`).digest();
  const received = Buffer.from(parts.v1, "hex");
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

const app = express();
app.post("/waybill", express.raw({ type: "application/json" }), (req, res) => {
  const body = req.body.toString("utf8");
  if (!verify(req.get("Waybill-Signature") ?? "", body)) return res.sendStatus(400);

  const event = JSON.parse(body);
  // Deduplicate on event.id, then handle event.type...
  res.sendStatus(204);
});
```

While you rotate a secret, accept both the old and the new one for a short time on your side.

### Testing a webhook

Use a tunnel such as `ngrok http 3000` to get a public `https` URL for a local receiver. Add it,
change a shipment's status, and look at the **Latest deliveries** list: each row shows the attempt
count, the last HTTP status or error, and **Resend** for finished deliveries.

## Not in the API

Assigning drivers, live positions and managing keys and webhooks are dashboard-only. The API has no CORS headers:
call it from servers, not from browsers.
