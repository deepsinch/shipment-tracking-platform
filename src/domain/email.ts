import type { ActorRole } from "./roles";
import type { ShipmentStatus } from "./shipment-status";

/**
 * Customer email notifications: which status changes send one, how a message is shown to staff
 * and which transport sends it. Pure. See docs/architecture.md, "Email".
 */

/**
 * The statuses a customer is told about. `created` is the booking itself (the customer asked for
 * it), `in_transit` is noise, and `cancelled` is a conversation, not a notification.
 */
export const EMAIL_NOTIFY_STATUSES = [
  "picked_up",
  "out_for_delivery",
  "delivered",
  "exception",
] as const satisfies readonly ShipmentStatus[];

export function shouldEmailForStatus(status: ShipmentStatus): boolean {
  return (EMAIL_NOTIFY_STATUSES as readonly string[]).includes(status);
}

/**
 * - `pending`: queued, never attempted. `failed`: retrying. `dead`: gave up.
 * - `succeeded`: handed to the transport (see `transport`).
 * - `suppressed`: the recipient opted out between queueing and sending.
 */
export const EMAIL_MESSAGE_STATUSES = [
  "pending",
  "succeeded",
  "failed",
  "dead",
  "suppressed",
] as const;
export type EmailMessageStatus = (typeof EMAIL_MESSAGE_STATUSES)[number];

export const EMAIL_TRANSPORTS = ["resend", "preview"] as const;
export type EmailTransportName = (typeof EMAIL_TRANSPORTS)[number];

/** Staff who can see whether a shipment's customer was emailed. */
export function canViewEmailStatus(role: ActorRole): boolean {
  return role === "admin" || role === "dispatcher";
}

/** The stored previews hold customers' addresses and message text: admins only. */
export function canViewEmailPreviews(role: ActorRole): boolean {
  return role === "admin";
}

export type EmailDisplayStatus = "queued" | "sent" | "preview" | "failed" | "opted_out";

export const EMAIL_DISPLAY_LABELS: Readonly<Record<EmailDisplayStatus, string>> = {
  queued: "Queued",
  sent: "Sent",
  preview: "Preview only",
  failed: "Failed",
  opted_out: "Opted out",
};

export function emailDisplayStatus(message: {
  status: EmailMessageStatus;
  transport: EmailTransportName | null;
}): EmailDisplayStatus {
  switch (message.status) {
    case "pending":
    case "failed":
      return "queued";
    case "succeeded":
      return message.transport === "resend" ? "sent" : "preview";
    case "dead":
      return "failed";
    case "suppressed":
      return "opted_out";
  }
}

/**
 * Which transport sends mail. Demo mode is always `preview`: recipients are whatever visitors
 * type, so a real send would be an abuse vector (decision 52). Without both the Resend API key and
 * a sender address there is nothing to send with, so it is `preview` too.
 */
export function selectEmailTransport(config: {
  demoMode: boolean;
  resendApiKey: string | undefined;
  from: string | undefined;
}): EmailTransportName {
  if (config.demoMode) return "preview";
  return config.resendApiKey && config.from ? "resend" : "preview";
}

/**
 * Whether a provider's HTTP answer means retrying cannot help. A rejected request (bad input, an
 * unverified sender domain, a bad or revoked key) fails the same way on every retry, so the message
 * ends as dead at once instead of burning the backoff schedule. Timeouts, conflicts, rate limits and
 * server errors are retried. Fixing the configuration sends the next emails; messages that already
 * failed keep their reason on the shipment page.
 */
export function isPermanentEmailFailure(httpStatus: number): boolean {
  return [400, 401, 403, 404, 405, 422].includes(httpStatus);
}
