import type { ActorRole } from "./roles";

/**
 * API keys: who manages them, what they may be scoped to, and the shape of the secret.
 * See docs/architecture.md, "Public API".
 */

/** Only admins create, list and revoke keys: a key acts for the whole organization. */
export function canManageApiKeys(role: ActorRole): boolean {
  return role === "admin";
}

export const API_SCOPES = ["shipments:read", "shipments:write"] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export const API_SCOPE_LABELS: Readonly<Record<ApiScope, { label: string; description: string }>> =
  {
    "shipments:read": {
      label: "Read shipments",
      description: "List shipments and read one with its history.",
    },
    "shipments:write": {
      label: "Write shipments",
      description: "Create shipments and change their status.",
    },
  };

export function isApiScope(value: unknown): value is ApiScope {
  return typeof value === "string" && (API_SCOPES as readonly string[]).includes(value);
}

/** Every key starts with this, so a leaked key is recognisable (and scannable by secret scanners). */
export const API_KEY_PREFIX = "wb_live_";

/** 32 random bytes in base64url are 43 characters (no padding). */
const SECRET_LENGTH = 43;

const KEY_PATTERN = new RegExp(`^${API_KEY_PREFIX}[A-Za-z0-9_-]{${SECRET_LENGTH}}$`);

/** Whether `value` has the shape of a key, so anything else is rejected before touching the database. */
export function looksLikeApiKey(value: string): boolean {
  return KEY_PATTERN.test(value);
}

/** How many characters of the secret part are kept for display, enough to tell keys apart. */
const DISPLAY_CHARS = 4;

/** "wb_live_AbCd": stored in clear next to the hash so admins can recognise a key in the list. */
export function displayPrefixOf(key: string): string {
  return key.slice(0, API_KEY_PREFIX.length + DISPLAY_CHARS);
}

/** The `Authorization` header's bearer token, or null when absent or not a Bearer credential. */
export function bearerTokenOf(authorization: string | null): string | null {
  const match = /^Bearer +(\S+)$/i.exec(authorization?.trim() ?? "");
  return match ? match[1]! : null;
}
