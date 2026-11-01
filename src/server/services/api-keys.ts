import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";

import {
  API_KEY_PREFIX,
  API_SCOPES,
  canManageApiKeys,
  displayPrefixOf,
  looksLikeApiKey,
  type ApiScope,
} from "@/domain/api-keys";
import { API_ROLE } from "@/domain/roles";
import type { AuthContext } from "@/server/auth/auth-context";
import { getDb } from "@/server/db/client";
import { apiKeys, member, user } from "@/server/db/schema";

import {
  forbidden,
  notFound,
  validationFailure,
  type Forbidden,
  type NotFound,
  type ValidationFailure,
} from "./results";

/** What the admin UI shows about a key. Never the hash, never the secret. */
export type ApiKeySummary = {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiScope[];
  createdAt: Date;
  /** Name of the admin who created it. */
  createdByName: string;
  /** Approximate: written at most once a minute. */
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

export const createApiKeySchema = z.object({
  name: z
    .string({ error: "Enter a name for the key" })
    .trim()
    .min(1, "Enter a name for the key")
    .max(100, "Use at most 100 characters"),
  /** Checkbox groups submit one entry per ticked box; a single value arrives as a string. */
  scopes: z.preprocess(
    (value) => (typeof value === "string" ? [value] : (value ?? [])),
    z
      .array(z.enum(API_SCOPES, { error: "Choose from the listed scopes" }))
      .min(1, "Choose at least one scope")
      .transform((scopes) => [...new Set(scopes)]),
  ),
});

export type CreateApiKeyInput = z.input<typeof createApiKeySchema>;

export type CreateApiKeyResult =
  /** `secret` is the only time the key is available in clear: show it, never store it. */
  { ok: true; key: ApiKeySummary; secret: string } | Forbidden | ValidationFailure;

/** SHA-256 of the whole key, hex. See `authenticateApiKey` for why a plain hash is enough. */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** `wb_live_` plus 32 random bytes (256 bits) in base64url. */
export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** Creates a key for the caller's organization. Admins only. */
export async function createApiKey(ctx: AuthContext, input: unknown): Promise<CreateApiKeyResult> {
  if (!canManageApiKeys(ctx.role)) return forbidden;
  const parsed = createApiKeySchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const secret = generateApiKey();
  const [row] = await getDb()
    .insert(apiKeys)
    .values({
      organizationId: ctx.organizationId,
      name: parsed.data.name,
      prefix: displayPrefixOf(secret),
      keyHash: hashApiKey(secret),
      scopes: parsed.data.scopes,
      createdBy: ctx.userId,
    })
    .returning({ id: apiKeys.id });

  const [created] = await listKeys(ctx.organizationId, row!.id);
  return { ok: true, key: created!, secret };
}

export type ListApiKeysResult = { ok: true; keys: ApiKeySummary[] } | Forbidden;

/** The organization's keys, newest first, revoked ones included. Admins only. */
export async function listApiKeys(ctx: AuthContext): Promise<ListApiKeysResult> {
  if (!canManageApiKeys(ctx.role)) return forbidden;
  return { ok: true, keys: await listKeys(ctx.organizationId) };
}

async function listKeys(organizationId: string, id?: string): Promise<ApiKeySummary[]> {
  // An explicit column list: `key_hash` must never leave this module.
  const rows = await getDb()
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      scopes: apiKeys.scopes,
      createdAt: apiKeys.createdAt,
      createdByName: user.name,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .innerJoin(user, eq(user.id, apiKeys.createdBy))
    .where(and(eq(apiKeys.organizationId, organizationId), id ? eq(apiKeys.id, id) : undefined))
    .orderBy(desc(apiKeys.createdAt), desc(apiKeys.id));
  // The CHECK constraint guarantees every stored scope is a known one.
  return rows as ApiKeySummary[];
}

export type RevokeApiKeyResult = { ok: true } | Forbidden | NotFound;

/**
 * Revokes a key of the caller's organization. Idempotent: revoking a revoked key succeeds and
 * keeps the original revocation time. Keys of other organizations (and malformed ids) are not
 * found. Takes effect on the next request, because every request looks the key up.
 */
export async function revokeApiKey(
  ctx: AuthContext,
  id: string,
  now: Date = new Date(),
): Promise<RevokeApiKeyResult> {
  if (!canManageApiKeys(ctx.role)) return forbidden;
  if (!z.uuid().safeParse(id).success) return notFound;

  const db = getDb();
  const mine = and(eq(apiKeys.id, id), eq(apiKeys.organizationId, ctx.organizationId));
  const revoked = await db
    .update(apiKeys)
    .set({ revokedAt: now })
    .where(and(mine, isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id });
  if (revoked.length > 0) return { ok: true };

  const [existing] = await db.select({ id: apiKeys.id }).from(apiKeys).where(mine).limit(1);
  return existing ? { ok: true } : notFound;
}

/** A request's identity: the context services run with, the key's scopes and its id. */
export type ApiKeyIdentity = { ctx: AuthContext; scopes: ApiScope[]; keyId: string };

/** `last_used_at` is refreshed when it is older than this. */
export const LAST_USED_GRANULARITY_MS = 60_000;

/**
 * Authenticates a bearer token: the key's identity, or null when the token is not a key, is
 * unknown or was revoked. Callers answer all three the same way (401), so a response never says
 * which part was wrong.
 *
 * Why a hash lookup and no constant-time comparison: the key is 256 random bits, and we look it
 * up by its SHA-256 through the unique index on `key_hash`; the stored secret is never compared
 * with `===`. Timing differences in the index lookup would reveal something about the *hash* being
 * matched, but an attacker cannot choose a key to steer its hash (that needs a SHA-256 preimage),
 * so there is nothing to learn from the timing. `timingSafeEqual` guards comparisons of
 * attacker-controlled input against a stored secret (a token against a token, an HMAC); here that
 * comparison is done by the hash itself. A database leak exposes only hashes, which cannot be
 * turned back into keys (and a slow password hash would add nothing for 256-bit random input).
 *
 * The AuthContext acts as the admin who created the key (`userId`), with the synthetic `api` role.
 * A key whose creator is no longer an admin member of the key's organization is rejected like an
 * unknown one (the same 401).
 *
 * `last_used_at` is written at most once per `LAST_USED_GRANULARITY_MS`: the common request only
 * reads. The conditional UPDATE keeps it to one write even when requests race.
 */
export async function authenticateApiKey(
  bearer: string | null,
  now: Date = new Date(),
): Promise<ApiKeyIdentity | null> {
  if (!bearer || !looksLikeApiKey(bearer)) return null;

  const db = getDb();
  const [key] = await db
    .select({
      id: apiKeys.id,
      organizationId: apiKeys.organizationId,
      createdBy: apiKeys.createdBy,
      scopes: apiKeys.scopes,
      lastUsedAt: apiKeys.lastUsedAt,
    })
    .from(apiKeys)
    // The key acts as its creator, so it works only while the creator is still an admin of the
    // key's organization: removing or demoting them switches their keys off at the next request,
    // with no revocation step to forget. (The rows stay: a restored admin gets the keys back.)
    .innerJoin(
      member,
      and(
        eq(member.userId, apiKeys.createdBy),
        eq(member.organizationId, apiKeys.organizationId),
        eq(member.role, "admin"),
      ),
    )
    .where(and(eq(apiKeys.keyHash, hashApiKey(bearer)), isNull(apiKeys.revokedAt)))
    .limit(1);
  if (!key) return null;

  const staleBefore = new Date(now.getTime() - LAST_USED_GRANULARITY_MS);
  if (!key.lastUsedAt || key.lastUsedAt < staleBefore) {
    await db
      .update(apiKeys)
      .set({ lastUsedAt: now })
      .where(
        and(
          eq(apiKeys.id, key.id),
          or(isNull(apiKeys.lastUsedAt), lt(apiKeys.lastUsedAt, staleBefore)),
          // A key revoked since the lookup is not "used" any more.
          isNull(apiKeys.revokedAt),
        ),
      );
  }

  return {
    ctx: { userId: key.createdBy, organizationId: key.organizationId, role: API_ROLE },
    // The CHECK constraint guarantees every stored scope is a known one.
    scopes: key.scopes as ApiScope[],
    keyId: key.id,
  };
}
