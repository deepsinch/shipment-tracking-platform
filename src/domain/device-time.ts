/**
 * Times reported by a driver's device (status updates recorded offline, location fixes). The
 * server accepts backdated times but not ones from the future, with some slack for device clocks
 * that run fast.
 */

/** Tolerated clock difference between a driver's device and the server. */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Whether a device-reported time is too far ahead of the server clock to be believed. */
export function isTooFarInFuture(deviceTime: Date, now: Date): boolean {
  return deviceTime.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS;
}
