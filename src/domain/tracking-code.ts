/**
 * Public tracking codes: `WB-XXXX-XXXX` in Crockford base32.
 *
 * The alphabet omits I, L, O and U so codes are easy to read aloud and type.
 * Eight symbols of 5 bits each give 40 bits of randomness from
 * `crypto.getRandomValues`, so codes are neither sequential nor enumerable.
 * See docs/architecture.md, "Tracking codes".
 */

export const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const PREFIX = "WB";
const SYMBOL_COUNT = 8;
const CANONICAL_PATTERN = /^WB-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/**
 * Crockford decoding is forgiving about look-alike characters: I and L read as 1,
 * O reads as 0. U is never valid.
 */
const LOOKALIKES: Readonly<Record<string, string>> = { I: "1", L: "1", O: "0" };

export function generateTrackingCode(): string {
  // 5 random bytes = exactly 40 bits = exactly 8 base32 symbols, so there is no modulo bias.
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  // 40 bits fit exactly in a JS number (safe up to 2^53), so plain arithmetic is enough.
  let value = 0;
  for (const byte of bytes) {
    value = value * 256 + byte;
  }

  let symbols = "";
  for (let i = SYMBOL_COUNT - 1; i >= 0; i--) {
    symbols += CROCKFORD_ALPHABET[Math.floor(value / 32 ** i) % 32];
  }
  return formatSymbols(symbols);
}

/** True only for the canonical form, e.g. `WB-7K3M-Q9TX`. */
export function isCanonicalTrackingCode(value: string): boolean {
  return CANONICAL_PATTERN.test(value);
}

/**
 * Turns user input into the canonical form, or returns null if it cannot be a tracking code.
 * Accepts lowercase, spaces, missing or extra dashes, and Crockford look-alikes (I, L, O).
 * The `WB` prefix is required so arbitrary 8-character strings are not mistaken for codes.
 */
export function normalizeTrackingCode(input: string): string | null {
  const compact = input.toUpperCase().replace(/[\s-]/g, "");
  if (!compact.startsWith(PREFIX)) return null;

  const symbols = compact
    .slice(PREFIX.length)
    .replace(/[ILO]/g, (char) => LOOKALIKES[char] ?? char);
  if (symbols.length !== SYMBOL_COUNT) return null;
  if (![...symbols].every((char) => CROCKFORD_ALPHABET.includes(char))) return null;

  return formatSymbols(symbols);
}

function formatSymbols(symbols: string): string {
  return `${PREFIX}-${symbols.slice(0, 4)}-${symbols.slice(4)}`;
}
