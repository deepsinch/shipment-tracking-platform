import { z } from "zod";

/**
 * Treats a blank form value (empty or whitespace-only string, or null) as "not provided", so an
 * optional field left empty passes validation instead of failing e.g. the email or number check.
 */
export function blankToUndefined<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) =>
      value === null || (typeof value === "string" && value.trim() === "") ? undefined : value,
    schema.optional(),
  );
}

/** Optional free text: trimmed, blank becomes undefined, capped at `max` characters. */
export function optionalText(max: number) {
  return blankToUndefined(z.string().trim().max(max, `Use at most ${max} characters`));
}

/** Optional latitude or longitude, coerced from form strings. */
export function optionalCoordinate(kind: "latitude" | "longitude") {
  const limit = kind === "latitude" ? 90 : 180;
  const message = `Enter a ${kind} between -${limit} and ${limit}`;
  return blankToUndefined(
    z.coerce.number({ error: message }).min(-limit, message).max(limit, message),
  );
}
