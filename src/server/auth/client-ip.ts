/**
 * The client's IP address for rate limiting.
 *
 * Takes the first entry of `x-forwarded-for`, which is the client as seen by the first proxy. This
 * trusts the hosting platform's proxy to set the header (Vercel overwrites it with the real client
 * address). Without such a proxy in front, a client can send any value, so a self-hosted deployment
 * must put a proxy that sets the header in front of the app. Falls back to `x-real-ip`, then to a
 * shared "unknown" bucket (which keeps the limits in force rather than disabling them).
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}
