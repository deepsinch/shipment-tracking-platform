import "server-only";

import { after } from "next/server";

import { drainDueDeliveries } from "@/server/services/webhook-delivery";

import { claimWebhookDrain } from "./drain-throttle";

/**
 * Hooks that make webhook delivery happen on a host without a worker: both run through Next's
 * `after()`, i.e. once the response has been sent, so the user never waits for a receiver.
 *
 * Outside a request (tests that call a handler directly, the CLI scripts) there is no `after()`
 * to attach to; the work is skipped and the rows stay queued for the next drain. Errors in the
 * background task are logged, never thrown: there is no one left to tell.
 */

function afterResponse(task: () => Promise<unknown>): void {
  const run = async () => {
    try {
      await task();
    } catch (error) {
      console.error("Webhook drain failed", error);
    }
  };
  try {
    after(run);
  } catch (error) {
    if (!(error instanceof Error && error.message.includes("outside a request scope"))) throw error;
  }
}

/** First attempt: call after a change that may have queued webhooks, once its response is sent. */
export function deliverWebhooksAfterResponse(): void {
  afterResponse(() => drainDueDeliveries());
}

/**
 * Retries: call on ordinary app and API activity. At most one drain per 30 seconds runs, whoever
 * asks (`claimWebhookDrain`), so a busy API does not turn into a busy drain.
 */
export function drainWebhooksOnActivity(): void {
  afterResponse(async () => {
    if (await claimWebhookDrain()) await drainDueDeliveries();
  });
}
