"use server";

import { revalidatePath } from "next/cache";

import { unsubscribeWithToken } from "@/server/services/email-notifications";

/**
 * The unsubscribe button. The token in the form is the only authority (see
 * `unsubscribeWithToken`); an invalid one changes nothing, and the page, which is re-rendered
 * either way, says what is true. Works without JavaScript: it is a plain form post.
 */
export async function unsubscribeAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  await unsubscribeWithToken(token);
  revalidatePath(`/unsubscribe/${token}`);
}
