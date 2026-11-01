import type { ActorRole } from "./roles";

/**
 * Webhooks: event types, the delivery state machine and the retry schedule. Pure, so the whole
 * lifecycle is unit tested without a database or a network. See docs/architecture.md,
 * "Webhooks without a long-running worker".
 */

/** Only admins manage endpoints: a webhook ships the organization's shipment data elsewhere. */
export function canManageWebhooks(role: ActorRole): boolean {
  return role === "admin";
}

export const WEBHOOK_EVENT_TYPES = [
  "shipment.created",
  "shipment.status_changed",
  "shipment.driver_assigned",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export const WEBHOOK_EVENT_LABELS: Readonly<
  Record<WebhookEventType, { label: string; description: string }>
> = {
  "shipment.created": {
    label: "Shipment created",
    description: "A shipment was booked, from the dashboard or the API.",
  },
  "shipment.status_changed": {
    label: "Status changed",
    description: "A shipment moved to a new status.",
  },
  "shipment.driver_assigned": {
    label: "Driver assigned",
    description: "A driver was assigned, changed or removed.",
  },
};

export function isWebhookEventType(value: unknown): value is WebhookEventType {
  return typeof value === "string" && (WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}

/** An organization may have this many endpoints (disabled ones included: they are never deleted). */
export const MAX_WEBHOOK_ENDPOINTS = 10;

/**
 * - `pending`: queued, never attempted.
 * - `failed`: attempted, failed, waiting for its next attempt.
 * - `succeeded`: the receiver answered 2xx.
 * - `dead`: every attempt failed; only "Resend" creates a new delivery of the event.
 */
export const DELIVERY_STATUSES = ["pending", "succeeded", "failed", "dead"] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** Statuses a drain may pick up (once `next_attempt_at` has passed). */
export const OPEN_DELIVERY_STATUSES = ["pending", "failed"] as const satisfies DeliveryStatus[];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** The wait after the 1st, 2nd, ... failed attempt. After the last one the delivery is dead. */
export const RETRY_DELAYS_MS: readonly number[] = [
  1 * MINUTE,
  5 * MINUTE,
  30 * MINUTE,
  2 * HOUR,
  6 * HOUR,
];

/** One first attempt plus one per retry delay. */
export const MAX_DELIVERY_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

/** A delivery counts as delivered on any 2xx. Redirects (3xx) are failures: they are not followed. */
export function isDeliverySuccess(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 300;
}

export type DeliveryTransition =
  | { status: "succeeded"; nextAttemptAt: null }
  | { status: "failed"; nextAttemptAt: Date }
  | { status: "dead"; nextAttemptAt: null };

/**
 * What a delivery becomes after an attempt. `attempts` counts the attempt that just finished, so
 * the first failure schedules the first retry delay (1 minute) and the sixth is the last.
 */
export function transitionAfterAttempt(
  attempts: number,
  succeeded: boolean,
  now: Date,
): DeliveryTransition {
  if (succeeded) return { status: "succeeded", nextAttemptAt: null };
  const delay = RETRY_DELAYS_MS[attempts - 1];
  if (delay === undefined) return { status: "dead", nextAttemptAt: null };
  return { status: "failed", nextAttemptAt: new Date(now.getTime() + delay) };
}

/** Finished deliveries (not still queued or retrying) can be re-sent as a new delivery. */
export function canResend(status: DeliveryStatus): boolean {
  return status === "succeeded" || status === "dead";
}

/** An endpoint is switched off after this many dead deliveries in a row, with no success between. */
export const AUTO_DISABLE_AFTER_DEAD = 5;

export const DISABLED_REASONS = ["manual", "repeated_failures"] as const;
export type DisabledReason = (typeof DISABLED_REASONS)[number];

export const DISABLED_REASON_LABELS: Readonly<Record<DisabledReason, string>> = {
  manual: "Disabled by an admin",
  repeated_failures: "Disabled automatically after repeated failures",
};

/** `whsec_` plus 32 random bytes in base64url: the key receivers verify signatures with. */
export const WEBHOOK_SECRET_PREFIX = "whsec_";
