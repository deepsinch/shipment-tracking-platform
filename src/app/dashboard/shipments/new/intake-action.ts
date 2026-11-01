"use server";

import { notFound } from "next/navigation";

import { INTAKE_MAX_BYTES, type IntakeDraft } from "@/domain/intake";
import { requireAuthContext } from "@/server/auth/session";
import { extractShipmentDraft } from "@/server/services/intake";

/**
 * "Paste a request email": hands the text to `extractShipmentDraft` and returns values for the
 * form. It never creates anything; the dispatcher reviews the form and submits it through
 * `createShipmentAction` like any other booking. The pasted text is echoed back so a failed
 * attempt loses nothing.
 */

export type IntakeState = {
  draft?: IntakeDraft & { id: string };
  emailText?: string;
  error?: { title: string; message?: string };
};

export async function draftFromEmailAction(
  _prev: IntakeState,
  formData: FormData,
): Promise<IntakeState> {
  const ctx = await requireAuthContext();
  const raw = formData.get("emailText");
  const emailText = typeof raw === "string" ? raw : "";

  const result = await extractShipmentDraft(ctx, { emailText });
  if (result.ok) return { draft: { ...result.draft, id: crypto.randomUUID() }, emailText };

  switch (result.reason) {
    case "disabled":
      // The panel is not shown without a key, so this is a stale page or a hand-made request.
      notFound();
    case "forbidden":
      return {
        emailText,
        error: { title: "Only admins and dispatchers can create shipments." },
      };
    case "validation":
      return {
        emailText,
        error: {
          title: result.fieldErrors.emailText?.[0] ?? "Paste the email to read.",
          message: `Up to ${INTAKE_MAX_BYTES / 1024} KB of text.`,
        },
      };
    case "limit":
      return {
        emailText,
        error: {
          title:
            result.scope === "demo"
              ? "The demo has used its AI drafts for today"
              : "Your company has used its AI drafts for today",
          message: `Try again in about ${hoursText(result.retryAfterMs)}, or fill in the form by hand. This limit keeps the cost of the feature predictable.`,
        },
      };
    case "model_failed":
      return {
        emailText,
        error: {
          title: "The email could not be read right now",
          message: "Nothing was filled in. Try again in a moment, or fill in the form by hand.",
        },
      };
  }
}

function hoursText(ms: number): string {
  const hours = Math.max(1, Math.ceil(ms / (60 * 60_000)));
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}
