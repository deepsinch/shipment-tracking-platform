import "server-only";

import { z } from "zod";

import {
  INTAKE_DAILY_LIMIT_DEMO,
  INTAKE_DAILY_LIMIT_PER_ORGANIZATION,
  INTAKE_MAX_BYTES,
  type IntakeDraft,
} from "@/domain/intake";
import { canCreateShipments } from "@/domain/shipment-permissions";
import type { AuthContext } from "@/server/auth/auth-context";
import { consumeRateLimit, RATE_LIMITS, type RateLimitStatus } from "@/server/auth/rate-limit";
import { env } from "@/server/env";
import { buildDraft } from "@/server/intake/draft";
import { getIntakeModel, type IntakeModel } from "@/server/intake";

import { forbidden, validationFailure, type Forbidden, type ValidationFailure } from "./results";

export type ExtractShipmentDraftResult =
  | { ok: true; draft: IntakeDraft }
  | Forbidden
  | ValidationFailure
  /** No API key is configured, so the feature does not exist here. */
  | { ok: false; reason: "disabled" }
  /** The daily cap is used up (this organization's, or the whole demo's). */
  | { ok: false; reason: "limit"; scope: "organization" | "demo"; retryAfterMs: number }
  /** The model could not be reached or did not answer usably. Nothing was drafted. */
  | { ok: false; reason: "model_failed" };

export type ExtractShipmentDraftDeps = {
  /** Defaults to this deployment's model (null when intake is off). Tests pass a fake. */
  model?: IntakeModel | null;
  now?: () => Date;
  demoMode?: boolean;
  /** Defaults to the Postgres counters; tests can count calls. */
  consume?: (
    rule: (typeof RATE_LIMITS)[keyof typeof RATE_LIMITS],
    subject: string,
    now: Date,
  ) => Promise<RateLimitStatus>;
};

const emailTextSchema = z
  .string({ error: "Paste the email" })
  .trim()
  .min(1, "Paste the email")
  .refine((text) => new TextEncoder().encode(text).length <= INTAKE_MAX_BYTES, {
    error: `The email is too long (at most ${INTAKE_MAX_BYTES / 1024} KB). Paste only the request.`,
  });

/**
 * Reads a pasted request email into a draft for the new-shipment form. It books nothing: the
 * result is values to prefill, and a person reviews and submits them through `createShipment` like
 * any other booking. Admins and dispatchers only (the people who can create shipments).
 *
 * Order matters for cost: who may ask, whether the feature exists, whether the text is acceptable
 * (a rejected paste does not use up the day's allowance), then the daily cap, then the model. The
 * cap counts attempts, including failed ones, before the call: that is what a bill follows. In
 * demo mode strangers share one organization, so one global cap applies instead of the
 * per-organization one. The email text is never logged.
 */
export async function extractShipmentDraft(
  ctx: AuthContext,
  input: { emailText: unknown },
  deps: ExtractShipmentDraftDeps = {},
): Promise<ExtractShipmentDraftResult> {
  if (!canCreateShipments(ctx.role)) return forbidden;
  const model = deps.model === undefined ? await getIntakeModel() : deps.model;
  if (!model) return { ok: false, reason: "disabled" };

  const parsed = z.object({ emailText: emailTextSchema }).safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const { emailText } = parsed.data;

  const now = deps.now?.() ?? new Date();
  const demo = deps.demoMode ?? env.demo.enabled;
  const consume = deps.consume ?? consumeRateLimit;
  const limit = demo
    ? await consume(RATE_LIMITS.intakeDemoGlobal, "demo", now)
    : await consume(RATE_LIMITS.intakePerOrganization, ctx.organizationId, now);
  if (limit.limited) {
    return {
      ok: false,
      reason: "limit",
      scope: demo ? "demo" : "organization",
      retryAfterMs: limit.retryAfterMs,
    };
  }

  let raw: unknown;
  try {
    raw = await model.extract({ emailText, today: now.toISOString().slice(0, 10) });
  } catch {
    // The adapter already logged what it may (class and status, never the email).
    return { ok: false, reason: "model_failed" };
  }
  return { ok: true, draft: buildDraft(raw, emailText) };
}

/** "50 per organization per day", for messages. */
export const INTAKE_LIMIT_TEXT = {
  organization: `${INTAKE_DAILY_LIMIT_PER_ORGANIZATION} per day for your company`,
  demo: `${INTAKE_DAILY_LIMIT_DEMO} per day for the whole demo`,
} as const;
