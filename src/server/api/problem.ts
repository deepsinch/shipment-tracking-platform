import type { FieldErrors } from "@/server/services/results";

/**
 * RFC 9457 problem details, the one error format of the public API. Every non-2xx response is an
 * `application/problem+json` document, so a client needs one error parser. `type` is a stable
 * URN per kind (clients switch on it; the human-readable `title` and `detail` may change).
 */

export const PROBLEM_KINDS = {
  validation: { status: 400, title: "The request is not valid" },
  invalid_json: { status: 400, title: "The request body is not valid JSON" },
  unauthorized: { status: 401, title: "Authentication is required" },
  forbidden: { status: 403, title: "Not allowed" },
  not_found: { status: 404, title: "Not found" },
  invalid_transition: { status: 409, title: "The status change is not allowed" },
  precondition_failed: { status: 412, title: "The shipment has changed" },
  precondition_required: { status: 428, title: "If-Match is required" },
  rate_limited: { status: 429, title: "Too many requests" },
  internal: { status: 500, title: "Something went wrong" },
} as const;

export type ProblemKind = keyof typeof PROBLEM_KINDS;

export const PROBLEM_CONTENT_TYPE = "application/problem+json";

export const problemType = (kind: ProblemKind) =>
  `urn:waybill:problem:${kind.replaceAll("_", "-")}`;

export type ProblemOptions = {
  detail?: string;
  /** Field-level validation messages, keyed by field path (`originCity`, `location.lat`). */
  errors?: FieldErrors;
  /** Further members of the problem document, e.g. `from` and `to` of an invalid transition. */
  extensions?: Record<string, unknown>;
  headers?: HeadersInit;
};

export function problemResponse(kind: ProblemKind, options: ProblemOptions = {}): Response {
  const { status, title } = PROBLEM_KINDS[kind];
  const headers = new Headers(options.headers);
  headers.set("Content-Type", PROBLEM_CONTENT_TYPE);
  headers.set("Cache-Control", "no-store");
  return new Response(
    JSON.stringify({
      type: problemType(kind),
      title,
      status,
      ...(options.detail ? { detail: options.detail } : {}),
      ...(options.errors ? { errors: options.errors } : {}),
      ...options.extensions,
    }),
    { status, headers },
  );
}

/** `Retry-After` takes whole seconds; round up so a client never retries a moment too early. */
export function retryAfterSeconds(retryAfterMs: number): string {
  return String(Math.max(1, Math.ceil(retryAfterMs / 1000)));
}

export function rateLimitedResponse(retryAfterMs: number): Response {
  return problemResponse("rate_limited", {
    detail: "Slow down and retry after the delay in the Retry-After header.",
    headers: { "Retry-After": retryAfterSeconds(retryAfterMs) },
  });
}
