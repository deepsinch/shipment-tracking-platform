"use server";

import { revalidatePath } from "next/cache";

import type { ActionOutcome } from "@/components/action-message";
import { requireAuthContext } from "@/server/auth/session";
import type { FieldErrors } from "@/server/services/results";
import {
  createWebhookEndpoint,
  resendWebhookDelivery,
  rotateWebhookSecret,
  setWebhookEndpointEnabled,
} from "@/server/services/webhook-endpoints";
import { deliverWebhooksAfterResponse } from "@/server/webhooks/schedule";

/**
 * Thin wiring between the webhooks page and the endpoint services, which own authorization and
 * validation. Only admins may use them; the page also hides itself from everyone else.
 */

const WEBHOOKS_PATH = "/dashboard/settings/webhooks";

const ADMINS_ONLY: ActionOutcome = {
  outcome: "error",
  title: "Only admins can manage webhooks",
  message: "Ask an admin to make this change.",
};
const GONE: ActionOutcome = {
  outcome: "error",
  title: "This webhook no longer exists",
  message: "The list now shows the current endpoints.",
};

export type CreateWebhookState = {
  formError?: string;
  fieldErrors?: FieldErrors;
  /** Echoed after a failed attempt so nothing typed or ticked is lost. */
  values?: { url: string; eventTypes: string[] };
  /** Set once, right after creation: the only time the secret is available. */
  created?: { url: string; secret: string };
};

export async function createWebhookEndpointAction(
  _prev: CreateWebhookState,
  formData: FormData,
): Promise<CreateWebhookState> {
  const ctx = await requireAuthContext();
  const values = {
    url: String(formData.get("url") ?? ""),
    eventTypes: formData.getAll("eventTypes").map(String),
  };

  const result = await createWebhookEndpoint(ctx, values);
  if (result.ok) {
    revalidatePath(WEBHOOKS_PATH);
    return { created: { url: result.endpoint.url, secret: result.secret } };
  }
  switch (result.reason) {
    case "forbidden":
      return { formError: "Only admins can create webhooks.", values };
    case "limit":
      return {
        formError: `You can have at most ${result.max} webhooks. Disable one you no longer use, or contact support to raise the limit.`,
        values,
      };
    case "validation":
      return {
        formError: "Please correct the highlighted fields.",
        fieldErrors: result.fieldErrors,
        values,
      };
  }
}

export async function setWebhookEnabledAction(
  _prev: ActionOutcome,
  formData: FormData,
): Promise<ActionOutcome> {
  const ctx = await requireAuthContext();
  const enabled = formData.get("enabled") === "true";
  const result = await setWebhookEndpointEnabled(
    ctx,
    String(formData.get("endpointId") ?? ""),
    enabled,
  );
  revalidatePath(WEBHOOKS_PATH);

  if (result.ok) {
    if (enabled) deliverWebhooksAfterResponse();
    return { outcome: "updated", message: enabled ? "Webhook enabled." : "Webhook disabled." };
  }
  return result.reason === "forbidden" ? ADMINS_ONLY : GONE;
}

export type RotateSecretState = ActionOutcome & {
  /** Set once, right after rotation: the only time the new secret is available. */
  secret?: string;
};

export async function rotateWebhookSecretAction(
  _prev: RotateSecretState,
  formData: FormData,
): Promise<RotateSecretState> {
  const ctx = await requireAuthContext();
  const result = await rotateWebhookSecret(ctx, String(formData.get("endpointId") ?? ""));
  if (result.ok) {
    return { outcome: "updated", message: "New secret created.", secret: result.secret };
  }
  return result.reason === "forbidden" ? ADMINS_ONLY : GONE;
}

export async function resendDeliveryAction(
  _prev: ActionOutcome,
  formData: FormData,
): Promise<ActionOutcome> {
  const ctx = await requireAuthContext();
  const result = await resendWebhookDelivery(ctx, String(formData.get("deliveryId") ?? ""));
  revalidatePath(WEBHOOKS_PATH);

  if (result.ok) {
    deliverWebhooksAfterResponse();
    return { outcome: "updated", message: "Queued again. Refresh in a moment to see the result." };
  }
  switch (result.reason) {
    case "forbidden":
      return ADMINS_ONLY;
    case "not_found":
      return GONE;
    case "not_finished":
      return {
        outcome: "error",
        title: "This delivery is still being retried",
        message: "It will be sent again by itself. Resend is for finished deliveries.",
      };
    case "endpoint_disabled":
      return {
        outcome: "error",
        title: "This webhook is disabled",
        message: "Enable it first, then resend.",
      };
  }
}
