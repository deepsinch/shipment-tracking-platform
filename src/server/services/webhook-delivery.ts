import "server-only";

import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";

import {
  AUTO_DISABLE_AFTER_DEAD,
  isDeliverySuccess,
  OPEN_DELIVERY_STATUSES,
  transitionAfterAttempt,
} from "@/domain/webhooks";
import { signatureHeader } from "@/domain/webhook-signature";
import type { UrlPolicy } from "@/domain/webhook-url";
import { getDb, type Executor } from "@/server/db/client";
import { webhookDeliveries, webhookEndpoints, type WebhookDeliveryRow } from "@/server/db/schema";
import { env } from "@/server/env";
import { vetDestination, type Resolver } from "@/server/webhooks/destination";
import { postToDestination, type Transport } from "@/server/webhooks/transport";

/**
 * Delivering webhooks without a worker process (docs/architecture.md, "Webhooks without a
 * long-running worker"). `drainDueDeliveries` is the whole engine: it is called right after a
 * response (`after()`), from throttled app and API activity, and from the daily cron, and it is
 * safe to call from all of them at once.
 *
 * **Claiming.** A drain first claims a small batch of due rows in a short transaction:
 * `SELECT ... FOR UPDATE SKIP LOCKED`, then an UPDATE that counts the attempt and pushes
 * `next_attempt_at` a lease into the future. The HTTP calls happen afterwards, with no
 * transaction (and no connection) held open.
 *
 *   - `SKIP LOCKED` is the right tool when many workers pull from one queue: a drain that finds
 *     a row locked by another drain skips it and takes the next one, instead of waiting (and
 *     then, after the lock is released, sending the same webhook again). This is the opposite
 *     of the tick throttle, where concurrent callers want exactly one winner for *one* shared
 *     row and a conditional upsert is the tool.
 *   - The lease covers the time after the claim transaction commits: until it expires the row is
 *     not due, so a second drain starting while the first is mid-request does not pick it up. If
 *     the process dies mid-request the lease simply runs out and the row is retried (the attempt
 *     was already counted, so a crash cannot make a delivery try forever).
 *
 * Delivery is at least once: a receiver that answered 2xx just as we timed out gets the event
 * again. Every payload carries a stable event id for deduplication.
 */

export const DRAIN_BATCH_SIZE = 10;
/** How long a claim keeps a row away from other drains: the 5 s timeout, many times over. */
export const CLAIM_LEASE_MS = 2 * 60_000;
const MAX_ERROR_LENGTH = 300;

export type DeliveryDeps = {
  /** Injectable for tests: where host names resolve to. */
  resolve?: Resolver;
  /** Injectable for tests; defaults to the environment's setting (`WEBHOOKS_ALLOW_LOCAL_TARGETS`). */
  policy?: UrlPolicy;
  transport?: Transport;
  timeoutMs?: number;
};

export type DrainResult = {
  claimed: number;
  succeeded: number;
  failed: number;
  dead: number;
};

const OPEN = [...OPEN_DELIVERY_STATUSES];

export async function drainDueDeliveries(
  now: Date = new Date(),
  limit: number = DRAIN_BATCH_SIZE,
  deps: DeliveryDeps = {},
): Promise<DrainResult> {
  const claimed = await claimDueDeliveries(now, limit);
  const result: DrainResult = { claimed: claimed.length, succeeded: 0, failed: 0, dead: 0 };
  if (claimed.length === 0) return result;

  const endpoints = await getDb()
    .select()
    .from(webhookEndpoints)
    .where(inArray(webhookEndpoints.id, [...new Set(claimed.map((row) => row.endpointId))]));
  const endpointById = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]));

  // Independent receivers: a slow one must not hold up the others.
  const outcomes = await Promise.all(
    claimed.map(async (delivery) => {
      const endpoint = endpointById.get(delivery.endpointId)!;
      return recordOutcome(delivery, await attempt(delivery, endpoint, now, deps), now);
    }),
  );
  for (const status of outcomes) if (status) result[status] += 1;
  return result;
}

/**
 * Drains in batches until nothing is due or `maxBatches` is reached, for the daily cron, which
 * should clear a backlog rather than take one small bite.
 */
export async function drainBacklog(
  maxBatches: number = 10,
  now: () => Date = () => new Date(),
  deps: DeliveryDeps = {},
): Promise<DrainResult> {
  const total: DrainResult = { claimed: 0, succeeded: 0, failed: 0, dead: 0 };
  for (let batch = 0; batch < maxBatches; batch++) {
    const result = await drainDueDeliveries(now(), DRAIN_BATCH_SIZE, deps);
    for (const key of Object.keys(total) as (keyof DrainResult)[]) total[key] += result[key];
    if (result.claimed < DRAIN_BATCH_SIZE) break;
  }
  return total;
}

/** Claims up to `limit` due deliveries of enabled endpoints and counts the attempt. */
async function claimDueDeliveries(now: Date, limit: number): Promise<WebhookDeliveryRow[]> {
  return getDb().transaction(async (tx) => {
    const due = await tx
      .select({ id: webhookDeliveries.id })
      .from(webhookDeliveries)
      .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
      .where(
        and(
          inArray(webhookDeliveries.status, OPEN),
          lte(webhookDeliveries.nextAttemptAt, now),
          eq(webhookEndpoints.enabled, true),
        ),
      )
      .orderBy(asc(webhookDeliveries.nextAttemptAt), asc(webhookDeliveries.id))
      .limit(limit)
      .for("update", { of: webhookDeliveries, skipLocked: true });
    if (due.length === 0) return [];

    return tx
      .update(webhookDeliveries)
      .set({
        attempts: sql`${webhookDeliveries.attempts} + 1`,
        nextAttemptAt: new Date(now.getTime() + CLAIM_LEASE_MS),
        lastAttemptAt: now,
        updatedAt: now,
      })
      .where(
        and(
          inArray(
            webhookDeliveries.id,
            due.map((row) => row.id),
          ),
          // Re-checked on the row being updated: belt and braces next to the lock.
          inArray(webhookDeliveries.status, OPEN),
          lte(webhookDeliveries.nextAttemptAt, now),
        ),
      )
      .returning();
  });
}

type AttemptOutcome = { succeeded: boolean; statusCode: number | null; error: string | null };

const truncate = (text: string) =>
  text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH - 1)}…` : text;

/** One attempt: vet the destination, sign, POST. Never throws for a receiver's misbehaviour. */
async function attempt(
  delivery: WebhookDeliveryRow,
  endpoint: { url: string; secret: string },
  now: Date,
  deps: DeliveryDeps,
): Promise<AttemptOutcome> {
  const policy = deps.policy ?? { allowLocalTargets: env.webhooks.allowLocalTargets };
  const vetted = await vetDestination(endpoint.url, { policy, resolve: deps.resolve });
  if (!vetted.ok) {
    return { succeeded: false, statusCode: null, error: truncate(vetted.refusal.message) };
  }

  const body = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(now.getTime() / 1000);
  const result = await (deps.transport ?? postToDestination)({
    destination: vetted.destination,
    timeoutMs: deps.timeoutMs,
    body,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Waybill-Webhooks/1",
      "Waybill-Event": delivery.eventType,
      "Waybill-Delivery": delivery.id,
      "Waybill-Signature": signatureHeader(endpoint.secret, timestamp, body),
    },
  });

  if (result.kind === "error") {
    return { succeeded: false, statusCode: null, error: truncate(result.message) };
  }
  if (isDeliverySuccess(result.statusCode)) {
    return { succeeded: true, statusCode: result.statusCode, error: null };
  }
  const redirected = result.statusCode >= 300 && result.statusCode < 400;
  return {
    succeeded: false,
    statusCode: result.statusCode,
    error: redirected
      ? `Receiver answered ${result.statusCode}; redirects are not followed`
      : `Receiver answered ${result.statusCode}`,
  };
}

/**
 * Stores what happened and schedules the next step. The `attempts` condition means a result is
 * written only for the attempt that was claimed: if the row has been touched since (it cannot be
 * today, but a future "cancel" might), the stale result is dropped rather than overwriting.
 */
async function recordOutcome(
  delivery: WebhookDeliveryRow,
  outcome: AttemptOutcome,
  now: Date,
): Promise<"succeeded" | "failed" | "dead" | null> {
  const transition = transitionAfterAttempt(delivery.attempts, outcome.succeeded, now);
  return getDb().transaction(async (tx) => {
    const updated = await tx
      .update(webhookDeliveries)
      .set({
        status: transition.status,
        nextAttemptAt: transition.nextAttemptAt,
        lastStatusCode: outcome.statusCode,
        lastError: outcome.error,
        updatedAt: now,
      })
      .where(
        and(
          eq(webhookDeliveries.id, delivery.id),
          eq(webhookDeliveries.attempts, delivery.attempts),
          inArray(webhookDeliveries.status, OPEN),
        ),
      )
      .returning({ id: webhookDeliveries.id });
    if (updated.length === 0) return null;
    if (transition.status === "dead") await disableIfAlwaysFailing(tx, delivery, now);
    return transition.status;
  });
}

/**
 * An endpoint whose last `AUTO_DISABLE_AFTER_DEAD` finished deliveries all died is switched off,
 * so a receiver that is gone stops costing six attempts per event. An admin re-enables it.
 */
async function disableIfAlwaysFailing(
  tx: Executor,
  delivery: Pick<WebhookDeliveryRow, "endpointId">,
  now: Date,
): Promise<void> {
  const recent = await tx
    .select({ status: webhookDeliveries.status })
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.endpointId, delivery.endpointId),
        inArray(webhookDeliveries.status, ["succeeded", "dead"]),
      ),
    )
    .orderBy(desc(webhookDeliveries.updatedAt), desc(webhookDeliveries.id))
    .limit(AUTO_DISABLE_AFTER_DEAD);
  if (recent.length < AUTO_DISABLE_AFTER_DEAD || recent.some((row) => row.status !== "dead")) {
    return;
  }
  await tx
    .update(webhookEndpoints)
    .set({ enabled: false, disabledReason: "repeated_failures", updatedAt: now })
    .where(and(eq(webhookEndpoints.id, delivery.endpointId), eq(webhookEndpoints.enabled, true)));
}
