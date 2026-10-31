import type { z } from "zod";

/**
 * Expected outcomes of a service call are values, not exceptions: callers (Server Actions, route
 * handlers) switch on `reason` and TypeScript checks every case is handled. Services throw only for
 * unexpected failures such as a lost database connection.
 */

/** Validation messages keyed by field path, e.g. `originCity` or `location.lat`. */
export type FieldErrors = Record<string, string[]>;

export type ValidationFailure = { ok: false; reason: "validation"; fieldErrors: FieldErrors };
/** Also returned for records in another organization, so ids cannot be probed. */
export type NotFound = { ok: false; reason: "not_found" };
export type Forbidden = { ok: false; reason: "forbidden" };

export const notFound: NotFound = { ok: false, reason: "not_found" };
export const forbidden: Forbidden = { ok: false, reason: "forbidden" };

export function validationFailure(error: z.ZodError): ValidationFailure {
  return { ok: false, reason: "validation", fieldErrors: fieldErrorsOf(error) };
}

/**
 * Groups Zod issues by dotted path. Unlike `z.flattenError`, nested fields keep their own key
 * (`location.city`), so a form can show each message next to its input.
 */
export function fieldErrorsOf(error: z.ZodError): FieldErrors {
  const fieldErrors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "form";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return fieldErrors;
}
