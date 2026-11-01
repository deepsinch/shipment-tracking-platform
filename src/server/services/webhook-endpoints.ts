import "server-only";

import { randomBytes } from "node:crypto";

import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  canManageWebhooks,
  canResend,
  MAX_WEBHOOK_ENDPOINTS,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_SECRET_PREFIX,
  type DeliveryStatus,
  type DisabledReason,
  type WebhookEventType,
} from "@/domain/webhooks";
import { checkWebhookUrl } from "@/domain/webhook-url";
import type { AuthContext } from "@/server/auth/auth-context";
import { getDb } from "@/server/db/client";
import { user, webhookDeliveries, webhookEndpoints } from "@/server/db/schema";
import { env } from "@/server/env";

import {
  forbidden,
  notFound,
  validationFailure,
  type Forbidden,
  type NotFound,
  type ValidationFailure,
} from "./results";

/** What the admin UI shows about an endpoint. Never the secret. */
export type WebhookEndpointSummary = {
  id: string;
  url: string;
  eventTypes: WebhookEventType[];
  enabled: boolean;
  disabledReason: DisabledReason | null;
  createdAt: Date;
  /** Name of the admin who created it. */
  createdByName: string;
};

/** One row of the delivery log: what happened, never the payload or a response body. */
export type WebhookDeliverySummary = {
  id: string;
  eventId: string;
  eventType: WebhookEventType;
  status: DeliveryStatus;
  attempts: number;
  nextAttemptAt: Date | null;
  lastAttemptAt: Date | null;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: Date;
};

export const DELIVERY_LOG_LENGTH = 10;

export const createWebhookEndpointSchema = z.object({
  url: z.string({ error: "Enter the URL to send events to" }).trim(),
  /** Checkbox groups submit one entry per ticked box; a single value arrives as a string. */
  eventTypes: z.preprocess(
    (value) => (typeof value === "string" ? [value] : (value ?? [])),
    z
      .array(z.enum(WEBHOOK_EVENT_TYPES, { error: "Choose from the listed events" }))
      .min(1, "Choose at least one event")
      .transform((types) => [...new Set(types)]),
  ),
});

export type CreateWebhookEndpointInput = z.input<typeof createWebhookEndpointSchema>;

/** `whsec_` plus 32 random bytes (256 bits) in base64url. */
export function generateWebhookSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}${randomBytes(32).toString("base64url")}`;
}

const urlPolicy = () => ({ allowLocalTargets: env.webhooks.allowLocalTargets });

export type CreateWebhookEndpointResult =
  /** `secret` is shown once; later reads never return it. */
  | { ok: true; endpoint: WebhookEndpointSummary; secret: string }
  | { ok: false; reason: "limit"; max: number }
  | Forbidden
  | ValidationFailure;

/** Creates an endpoint for the caller's organization. Admins only. */
export async function createWebhookEndpoint(
  ctx: AuthContext,
  input: unknown,
): Promise<CreateWebhookEndpointResult> {
  if (!canManageWebhooks(ctx.role)) return forbidden;
  const parsed = createWebhookEndpointSchema.safeParse(input);
  // Fast feedback only; the real check runs again, with DNS, at every delivery. It runs even when
  // another field is invalid, so one submit reports every problem.
  const rawUrl = parsed.success ? parsed.data.url : (input as { url?: unknown } | null)?.url;
  const checked = typeof rawUrl === "string" ? checkWebhookUrl(rawUrl, urlPolicy()) : null;
  if (!parsed.success) {
    const failure = validationFailure(parsed.error, { "eventTypes.": "eventTypes" });
    if (checked && !checked.ok && !failure.fieldErrors.url) {
      failure.fieldErrors.url = [checked.message];
    }
    return failure;
  }
  if (!checked?.ok) {
    return { ok: false, reason: "validation", fieldErrors: { url: [checked!.message] } };
  }

  const db = getDb();
  const [existing] = await db
    .select({ total: count() })
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.organizationId, ctx.organizationId));
  if ((existing?.total ?? 0) >= MAX_WEBHOOK_ENDPOINTS) {
    return { ok: false, reason: "limit", max: MAX_WEBHOOK_ENDPOINTS };
  }

  const secret = generateWebhookSecret();
  const [row] = await db
    .insert(webhookEndpoints)
    .values({
      organizationId: ctx.organizationId,
      url: checked.url.toString(),
      secret,
      eventTypes: parsed.data.eventTypes,
      createdBy: ctx.userId,
    })
    .returning({ id: webhookEndpoints.id });

  const [created] = await listEndpoints(ctx.organizationId, row!.id);
  return { ok: true, endpoint: created!, secret };
}

export type ListWebhookEndpointsResult =
  | {
      ok: true;
      endpoints: (WebhookEndpointSummary & { deliveries: WebhookDeliverySummary[] })[];
    }
  | Forbidden;

/** The organization's endpoints, newest first, each with its latest deliveries. Admins only. */
export async function listWebhookEndpoints(ctx: AuthContext): Promise<ListWebhookEndpointsResult> {
  if (!canManageWebhooks(ctx.role)) return forbidden;
  const endpoints = await listEndpoints(ctx.organizationId);
  const withDeliveries = await Promise.all(
    endpoints.map(async (endpoint) => ({
      ...endpoint,
      deliveries: await latestDeliveries(ctx.organizationId, endpoint.id),
    })),
  );
  return { ok: true, endpoints: withDeliveries };
}

async function listEndpoints(
  organizationId: string,
  id?: string,
): Promise<WebhookEndpointSummary[]> {
  // An explicit column list: `secret` must never leave this module except from create/rotate.
  const rows = await getDb()
    .select({
      id: webhookEndpoints.id,
      url: webhookEndpoints.url,
      eventTypes: webhookEndpoints.eventTypes,
      enabled: webhookEndpoints.enabled,
      disabledReason: webhookEndpoints.disabledReason,
      createdAt: webhookEndpoints.createdAt,
      createdByName: user.name,
    })
    .from(webhookEndpoints)
    .innerJoin(user, eq(user.id, webhookEndpoints.createdBy))
    .where(
      and(
        eq(webhookEndpoints.organizationId, organizationId),
        id ? eq(webhookEndpoints.id, id) : undefined,
      ),
    )
    .orderBy(desc(webhookEndpoints.createdAt), desc(webhookEndpoints.id));
  // The CHECK constraints guarantee known event types and reasons.
  return rows as WebhookEndpointSummary[];
}

async function latestDeliveries(
  organizationId: string,
  endpointId: string,
): Promise<WebhookDeliverySummary[]> {
  const rows = await getDb()
    .select({
      id: webhookDeliveries.id,
      eventId: webhookDeliveries.eventId,
      eventType: webhookDeliveries.eventType,
      status: webhookDeliveries.status,
      attempts: webhookDeliveries.attempts,
      nextAttemptAt: webhookDeliveries.nextAttemptAt,
      lastAttemptAt: webhookDeliveries.lastAttemptAt,
      lastStatusCode: webhookDeliveries.lastStatusCode,
      lastError: webhookDeliveries.lastError,
      createdAt: webhookDeliveries.createdAt,
    })
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.organizationId, organizationId),
        eq(webhookDeliveries.endpointId, endpointId),
      ),
    )
    .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
    .limit(DELIVERY_LOG_LENGTH);
  return rows as WebhookDeliverySummary[];
}

const idSchema = z.uuid();

export type SetWebhookEnabledResult = { ok: true } | Forbidden | NotFound;

/**
 * Switches an endpoint on or off. Off keeps every delivery as history and stops new deliveries
 * being queued and queued ones being attempted; on resumes them. There is no delete: a log of what
 * was sent where should outlive the endpoint.
 */
export async function setWebhookEndpointEnabled(
  ctx: AuthContext,
  id: string,
  enabled: boolean,
  now: Date = new Date(),
): Promise<SetWebhookEnabledResult> {
  if (!canManageWebhooks(ctx.role)) return forbidden;
  if (!idSchema.safeParse(id).success) return notFound;

  const updated = await getDb()
    .update(webhookEndpoints)
    .set({ enabled, disabledReason: enabled ? null : "manual", updatedAt: now })
    .where(
      and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.organizationId, ctx.organizationId)),
    )
    .returning({ id: webhookEndpoints.id });
  return updated.length > 0 ? { ok: true } : notFound;
}

export type RotateWebhookSecretResult = { ok: true; secret: string } | Forbidden | NotFound;

/**
 * Replaces an endpoint's secret and shows the new one once. The old secret stops working for
 * deliveries made from now on; a delivery already in flight was signed with the old one. (A grace
 * period that signs with both is the next step if receivers need to rotate without a gap.)
 */
export async function rotateWebhookSecret(
  ctx: AuthContext,
  id: string,
  now: Date = new Date(),
): Promise<RotateWebhookSecretResult> {
  if (!canManageWebhooks(ctx.role)) return forbidden;
  if (!idSchema.safeParse(id).success) return notFound;

  const secret = generateWebhookSecret();
  const updated = await getDb()
    .update(webhookEndpoints)
    .set({ secret, updatedAt: now })
    .where(
      and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.organizationId, ctx.organizationId)),
    )
    .returning({ id: webhookEndpoints.id });
  return updated.length > 0 ? { ok: true, secret } : notFound;
}

export type ResendWebhookResult =
  | { ok: true; deliveryId: string }
  /** Only finished deliveries can be resent; one that is still being retried will be anyway. */
  | { ok: false; reason: "not_finished" }
  | { ok: false; reason: "endpoint_disabled" }
  | Forbidden
  | NotFound;

/**
 * Re-queues an event as a **new** delivery to the same endpoint, with the same event id and
 * payload, so the log keeps what happened the first time. Receivers that deduplicate on the event
 * id see it as the repeat it is. Due immediately; the caller starts the attempt.
 */
export async function resendWebhookDelivery(
  ctx: AuthContext,
  deliveryId: string,
  now: Date = new Date(),
): Promise<ResendWebhookResult> {
  if (!canManageWebhooks(ctx.role)) return forbidden;
  if (!idSchema.safeParse(deliveryId).success) return notFound;

  const db = getDb();
  const [row] = await db
    .select({
      delivery: webhookDeliveries,
      enabled: webhookEndpoints.enabled,
    })
    .from(webhookDeliveries)
    .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
    .where(
      and(
        eq(webhookDeliveries.id, deliveryId),
        eq(webhookDeliveries.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);
  if (!row) return notFound;
  if (!canResend(row.delivery.status)) return { ok: false, reason: "not_finished" };
  if (!row.enabled) return { ok: false, reason: "endpoint_disabled" };

  const [created] = await db
    .insert(webhookDeliveries)
    .values({
      organizationId: row.delivery.organizationId,
      endpointId: row.delivery.endpointId,
      eventId: row.delivery.eventId,
      eventType: row.delivery.eventType,
      payload: row.delivery.payload,
      nextAttemptAt: now,
    })
    .returning({ id: webhookDeliveries.id });
  return { ok: true, deliveryId: created!.id };
}
