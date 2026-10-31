"use server";

import { redirect } from "next/navigation";

import { normalizeTrackingCode } from "@/domain/tracking-code";

/**
 * "Track a shipment" form: sends the visitor to the canonical tracking URL. An unrecognizable
 * code still goes to /track/..., which shows the friendly not-found page.
 */
export async function trackShipmentAction(formData: FormData): Promise<void> {
  const raw = String(formData.get("code") ?? "").trim();
  const code = normalizeTrackingCode(raw) ?? raw;
  redirect(`/track/${encodeURIComponent(code || "unknown")}`);
}
