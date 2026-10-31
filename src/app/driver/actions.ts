"use server";

import type { Fix, SendOutcome } from "@/lib/location-sharer";
import { requireAuthContext } from "@/server/auth/session";
import { recordLocationPing } from "@/server/services/record-location-ping";

/**
 * Location pings from the driver app. A Server Action rather than a route handler: it is called
 * only by our own client component, gets the session cookie, Next's same-origin check and typed
 * arguments for free, and needs no public URL. A native app or the public API (Phase 3) would get
 * a route handler calling the same service.
 *
 * The client never sends faster than the throttle interval, but the service enforces it anyway.
 */

/** The ping as the driver app sends it: the latest fix for the shipment on screen. */
export type LocationPingInput = Fix & { shipmentId: string };

export async function sendLocationPingAction(input: LocationPingInput): Promise<SendOutcome> {
  const ctx = await requireAuthContext();
  const result = await recordLocationPing(ctx, input);

  if (result.ok) return result.accepted ? { status: "sent" } : { status: "throttled" };
  switch (result.reason) {
    case "inactive":
      // Someone changed the status elsewhere; refresh so the page shows it.
      return {
        status: "stopped",
        message: "This shipment is no longer on the road, so location sharing stopped.",
        refresh: true,
      };
    case "not_found":
      return {
        status: "stopped",
        message: "This shipment is no longer assigned to you, so location sharing stopped.",
        refresh: true,
      };
    case "forbidden":
      return {
        status: "stopped",
        message: "Only drivers can share their location.",
        refresh: false,
      };
    case "validation":
      return {
        status: "rejected",
        message: result.fieldErrors.recordedAt
          ? "Your phone's clock is ahead of the server, so positions are not being saved. Check the date and time settings."
          : "Your phone reported a position that could not be saved.",
      };
  }
}
