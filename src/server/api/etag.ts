/**
 * The shipment `version` as an HTTP entity tag. A strong ETag: it changes with every change to
 * the shipment, including ones that only add history, so `If-Match` is exact optimistic locking.
 */
export const etagOf = (version: number): string => `"${version}"`;

export type IfMatch =
  { kind: "missing" } | { kind: "malformed" } | { kind: "version"; version: number };

/**
 * Reads `If-Match` as a single shipment ETag. Weak tags (`W/"3"`), lists and `*` are not
 * accepted: the status change needs the one version the client based its decision on, so anything
 * else is reported as malformed instead of being guessed at.
 */
export function parseIfMatch(header: string | null): IfMatch {
  if (header === null) return { kind: "missing" };
  const match = /^"([1-9][0-9]{0,8})"$/.exec(header.trim());
  return match ? { kind: "version", version: Number(match[1]) } : { kind: "malformed" };
}
