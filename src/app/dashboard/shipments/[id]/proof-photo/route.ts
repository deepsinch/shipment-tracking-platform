import { getAuthContextFromHeaders } from "@/server/auth/request-context";
import { getDeliveryPhoto } from "@/server/services/delivery-proof";

/**
 * A delivery's photo, for the organization's staff. The photo is private in storage (no public or
 * signed URL exists), so this is the only way to see it: the session is checked on every request,
 * the shipment must be in the caller's organization, and drivers are refused. The browser gets the
 * bytes streamed, never the storage location.
 *
 * Like the realtime stream, an API-style endpoint answers 401 instead of redirecting to sign-in
 * (an `<img>` would follow the redirect and fail without a reason). Other refusals are 404, so the
 * route does not confirm that a shipment or a photo exists.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const viewer = await getAuthContextFromHeaders(request.headers);
  if (!viewer) return refusal(401);

  const result = await getDeliveryPhoto(viewer, (await params).id);
  if (!result.ok) return refusal(404);

  return new Response(result.body, {
    headers: {
      // The stored type was sniffed from the bytes at upload, never taken from the client.
      "Content-Type": result.contentType,
      // Private data: not for shared caches, and not kept after the member signs out.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      // If anyone opens the URL directly, it is an image and nothing more.
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
      "Content-Disposition": "inline",
    },
  });
}

function refusal(status: 401 | 404): Response {
  return new Response(status === 401 ? "Sign in to see this photo." : "Not found.", {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
