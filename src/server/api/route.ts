import "server-only";

import { bearerTokenOf, type ApiScope } from "@/domain/api-keys";
import type { AuthContext } from "@/server/auth/auth-context";
import { clientIp } from "@/server/auth/client-ip";
import { consumeRateLimit, RATE_LIMITS } from "@/server/auth/rate-limit";
import { authenticateApiKey } from "@/server/services/api-keys";
import { drainOutboxOnActivity } from "@/server/webhooks/schedule";
import type { FieldErrors } from "@/server/services/results";

import { problemResponse, rateLimitedResponse } from "./problem";

/**
 * The HTTP edge of the public API: authentication, rate limits and scopes around a handler that
 * calls a service. Handlers stay thin; the services own authorization, validation and
 * transactions, exactly as for the dashboard.
 *
 * Order of checks, and why: the bearer key is looked up first (401, counted against the client's
 * IP so guessing is throttled); then the per-key limit (429), so a runaway integration is cut
 * off before it costs more work; then the key's scope (403); then the handler.
 */

export type ApiCall<Params> = {
  request: Request;
  params: Params;
  /** The key's context: `api` role, acting in the key's organization. */
  ctx: AuthContext;
};

export type NextRouteContext<Params> = { params: Promise<Params> };

/** Wraps a handler as a Next route handler for the given scope. */
export function apiRoute<Params = Record<string, never>>(
  scope: ApiScope,
  handler: (call: ApiCall<Params>) => Promise<Response>,
): (request: Request, route: NextRouteContext<Params>) => Promise<Response> {
  return async (request, route) => {
    try {
      const identity = await authenticateApiKey(
        bearerTokenOf(request.headers.get("authorization")),
      );
      if (!identity) return await unauthorized(request);
      // Authenticated API traffic doubles as the heartbeat that retries due webhooks (throttled).
      drainOutboxOnActivity();

      const limit = await consumeRateLimit(RATE_LIMITS.apiPerKey, identity.keyId);
      if (limit.limited) return rateLimitedResponse(limit.retryAfterMs);

      if (!identity.scopes.includes(scope)) {
        return problemResponse("forbidden", {
          detail: `This API key does not have the "${scope}" scope.`,
        });
      }
      return await handler({ request, params: await route.params, ctx: identity.ctx });
    } catch (error) {
      return internalError(error);
    }
  };
}

/** Wraps an unauthenticated handler (public tracking), limited per client IP instead of per key. */
export function publicApiRoute<Params = Record<string, never>>(
  handler: (call: { request: Request; params: Params }) => Promise<Response>,
): (request: Request, route: NextRouteContext<Params>) => Promise<Response> {
  return async (request, route) => {
    try {
      const limit = await consumeRateLimit(RATE_LIMITS.apiTrackingPerIp, clientIp(request.headers));
      if (limit.limited) return rateLimitedResponse(limit.retryAfterMs);
      return await handler({ request, params: await route.params });
    } catch (error) {
      return internalError(error);
    }
  };
}

async function unauthorized(request: Request): Promise<Response> {
  const limit = await consumeRateLimit(RATE_LIMITS.apiInvalidKeyPerIp, clientIp(request.headers));
  if (limit.limited) return rateLimitedResponse(limit.retryAfterMs);
  // The same answer for a missing, malformed, unknown or revoked key.
  return problemResponse("unauthorized", {
    detail: "Send a valid API key as `Authorization: Bearer <key>`.",
    headers: { "WWW-Authenticate": 'Bearer realm="waybill-api"' },
  });
}

/** Details go to the log, never to the client. */
function internalError(error: unknown): Response {
  console.error("API request failed", error);
  return problemResponse("internal", { detail: "The request could not be completed. Try again." });
}

export type JsonOptions = { status?: number; etag?: string; headers?: HeadersInit };

/** A JSON response that is never cached (the data is private and changes). */
export function jsonResponse(body: unknown, options: JsonOptions = {}): Response {
  const headers = new Headers(options.headers);
  headers.set("Cache-Control", "no-store");
  if (options.etag) headers.set("ETag", options.etag);
  return Response.json(body, { status: options.status ?? 200, headers });
}

export type JsonBody =
  { ok: true; body: Record<string, unknown> } | { ok: false; response: Response };

/** The request body as a JSON object, or the 400 to send back. */
export async function readJsonObject(request: Request): Promise<JsonBody> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      response: problemResponse("invalid_json", { detail: "Send the request body as JSON." }),
    };
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      ok: false,
      response: problemResponse("validation", {
        detail: "The request body must be a JSON object.",
        errors: { form: ["Send a JSON object"] },
      }),
    };
  }
  return { ok: true, body: body as Record<string, unknown> };
}

/**
 * A 400 naming every field the API does not accept, or null. Stricter than the services' Zod
 * schemas (which silently drop unknown keys, fine for forms): an API client that misspells
 * `weightKg` should hear about it instead of getting a 400 about a missing field, or worse, a
 * shipment without an optional field it believed it had set.
 */
export function rejectUnknownFields(
  body: Record<string, unknown>,
  accepted: readonly string[],
): Response | null {
  const errors: FieldErrors = {};
  for (const key of Object.keys(body)) {
    if (!accepted.includes(key)) errors[key] = ["Unknown field"];
  }
  return Object.keys(errors).length > 0
    ? problemResponse("validation", { detail: "The request has unknown fields.", errors })
    : null;
}
