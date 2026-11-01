"use server";

import type { Fix, SendOutcome } from "@/lib/location-sharer";
import { requireAuthContext } from "@/server/auth/session";
import { recordDriverLocation } from "@/server/services/record-driver-location";

/**
 * Location pings from the driver app. A Server Action rather than a route handler: it is called
 * only by our own client component, gets the session cookie, Next's same-origin check and typed
 * arguments for free, and needs no public URL. A native app or the public API (Phase 3) would get
 * a route handler calling the same service.
 *
 * The client never sends faster than the throttle interval, but the service enforces it anyway.
 */

/**
 * The ping as the driver app sends it: the latest fix for the shipment on screen. On the public
 * demo the app sends the shipment id alone (the server derives a simulated position and ignores
 * anything else, see `recordDriverLocation`); everywhere else the fix is required.
 */
export type LocationPingInput = { shipmentId: string } & Partial<Fix>;

export async function sendLocationPingAction(input: LocationPingInput): Promise<SendOutcome> {
  const ctx = await requireAuthContext();
  const result = await recordDriverLocation(ctx, input);

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
    case "no_route":
      // Demo mode only: a shipment booked without coordinates has no route to simulate along.
      return {
        status: "stopped",
        message:
          "This demo shipment has no route coordinates, so there is no simulated position to share.",
        refresh: false,
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
