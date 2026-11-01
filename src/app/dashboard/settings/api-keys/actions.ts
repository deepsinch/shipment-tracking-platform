"use server";

import { revalidatePath } from "next/cache";

import type { ActionOutcome } from "@/components/action-message";
import { requireAuthContext } from "@/server/auth/session";
import { createApiKey, revokeApiKey } from "@/server/services/api-keys";
import type { FieldErrors } from "@/server/services/results";

/**
 * Thin wiring between the API keys page and the key services, which own authorization and
 * validation. Only admins may use them; the page also hides itself from everyone else.
 */

const API_KEYS_PATH = "/dashboard/settings/api-keys";

export type CreateApiKeyState = {
  formError?: string;
  fieldErrors?: FieldErrors;
  /** Echoed after a failed attempt so nothing typed or ticked is lost. */
  values?: { name: string; scopes: string[] };
  /** Set once, right after creation: the only time the secret is available. */
  created?: { name: string; secret: string };
};

export async function createApiKeyAction(
  _prev: CreateApiKeyState,
  formData: FormData,
): Promise<CreateApiKeyState> {
  const ctx = await requireAuthContext();
  const values = {
    name: String(formData.get("name") ?? ""),
    scopes: formData.getAll("scopes").map(String),
  };

  const result = await createApiKey(ctx, values);
  if (!result.ok) {
    return result.reason === "forbidden"
      ? { formError: "Only admins can create API keys.", values }
      : {
          formError: "Please correct the highlighted fields.",
          fieldErrors: result.fieldErrors,
          values,
        };
  }

  revalidatePath(API_KEYS_PATH);
  return { created: { name: result.key.name, secret: result.secret } };
}

export async function revokeApiKeyAction(
  _prev: ActionOutcome,
  formData: FormData,
): Promise<ActionOutcome> {
  const ctx = await requireAuthContext();
  const result = await revokeApiKey(ctx, String(formData.get("keyId") ?? ""));
  revalidatePath(API_KEYS_PATH);

  if (result.ok) return { outcome: "updated", message: "Key revoked." };
  switch (result.reason) {
    case "forbidden":
      return {
        outcome: "error",
        title: "Only admins can revoke API keys",
        message: "Ask an admin to make this change.",
      };
    case "not_found":
      return {
        outcome: "error",
        title: "This key no longer exists",
        message: "The list now shows the current keys.",
      };
  }
}
