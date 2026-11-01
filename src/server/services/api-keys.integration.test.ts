import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { API_KEY_PREFIX, looksLikeApiKey } from "@/domain/api-keys";
import type { AuthContext } from "@/server/auth/auth-context";
import { getDb } from "@/server/db/client";
import { apiKeys, member } from "@/server/db/schema";

import {
  createTestContext,
  createTestOrganization,
  pgErrorCode,
} from "../../../tests/integration/fixtures";
import {
  authenticateApiKey,
  createApiKey,
  hashApiKey,
  LAST_USED_GRANULARITY_MS,
  listApiKeys,
  revokeApiKey,
} from "./api-keys";

const rowOf = async (id: string) => {
  const [row] = await getDb().select().from(apiKeys).where(eq(apiKeys.id, id));
  return row!;
};

describe("API keys", () => {
  let admin: AuthContext;
  let dispatcher: AuthContext;
  let driver: AuthContext;
  let outsider: AuthContext;

  beforeAll(async () => {
    const orgId = (await createTestOrganization()).id;
    admin = await createTestContext(orgId, "admin");
    dispatcher = await createTestContext(orgId, "dispatcher");
    driver = await createTestContext(orgId, "driver");
    outsider = await createTestContext((await createTestOrganization("Other")).id, "admin");
  });

  const create = async (
    ctx = admin,
    input: unknown = { name: "ERP", scopes: ["shipments:read"] },
  ) => {
    const result = await createApiKey(ctx, input);
    if (!result.ok) throw new Error(`unexpected failure: ${JSON.stringify(result)}`);
    return result;
  };

  describe("createApiKey", () => {
    it("returns the secret once and stores only its hash and display prefix", async () => {
      const { key, secret } = await create(admin, {
        name: "  ERP integration ",
        scopes: ["shipments:read", "shipments:write", "shipments:read"],
      });

      expect(secret.startsWith(API_KEY_PREFIX)).toBe(true);
      expect(looksLikeApiKey(secret)).toBe(true);
      expect(key).toMatchObject({
        name: "ERP integration",
        prefix: secret.slice(0, 12),
        scopes: ["shipments:read", "shipments:write"],
        createdByName: "Test admin",
        lastUsedAt: null,
        revokedAt: null,
      });
      const row = await rowOf(key.id);
      expect(row.keyHash).toBe(hashApiKey(secret));
      expect(JSON.stringify(row)).not.toContain(secret);
      expect(Object.keys(key)).not.toContain("keyHash");
    });

    it("generates a different secret every time", async () => {
      const secrets = await Promise.all([create(), create(), create()]);
      expect(new Set(secrets.map((result) => result.secret)).size).toBe(3);
    });

    it("is for admins only", async () => {
      for (const ctx of [dispatcher, driver, { ...admin, role: "api" as const }]) {
        expect(await createApiKey(ctx, { name: "x", scopes: ["shipments:read"] })).toEqual({
          ok: false,
          reason: "forbidden",
        });
      }
    });

    it("validates the name and scopes", async () => {
      expect(await createApiKey(admin, { name: " ", scopes: [] })).toEqual({
        ok: false,
        reason: "validation",
        fieldErrors: {
          name: ["Enter a name for the key"],
          scopes: ["Choose at least one scope"],
        },
      });
      expect(await createApiKey(admin, { name: "x", scopes: ["shipments:delete"] })).toMatchObject({
        ok: false,
        reason: "validation",
      });
      // A single ticked checkbox arrives as a string.
      expect(await createApiKey(admin, { name: "x", scopes: "shipments:read" })).toMatchObject({
        ok: true,
      });
    });

    it("is backed by CHECK constraints, not only by Zod", async () => {
      const base = {
        organizationId: admin.organizationId,
        name: "raw",
        prefix: "wb_live_xxxx",
        createdBy: admin.userId,
      };
      const insert = (values: Partial<typeof apiKeys.$inferInsert>) =>
        getDb()
          .insert(apiKeys)
          .values({
            ...base,
            keyHash: hashApiKey(Math.random().toString()),
            scopes: ["shipments:read"],
            ...values,
          });

      await expect(insert({ scopes: [] })).rejects.toSatisfy((e) => pgErrorCode(e) === "23514");
      await expect(insert({ scopes: ["admin:everything"] })).rejects.toSatisfy(
        (e) => pgErrorCode(e) === "23514",
      );
      await expect(insert({ name: "  " })).rejects.toSatisfy((e) => pgErrorCode(e) === "23514");
    });
  });

  describe("listApiKeys", () => {
    it("lists the organization's keys, newest first, revoked ones included, without hashes", async () => {
      const org = (await createTestOrganization("Lister")).id;
      const owner = await createTestContext(org, "admin");
      const first = await create(owner, { name: "first", scopes: ["shipments:read"] });
      const second = await create(owner, { name: "second", scopes: ["shipments:write"] });
      await revokeApiKey(owner, first.key.id);

      const result = await listApiKeys(owner);
      if (!result.ok) throw new Error("unexpected failure");
      expect(result.keys.map((key) => key.name)).toEqual(["second", "first"]);
      expect(result.keys[1]!.revokedAt).toBeInstanceOf(Date);
      expect(JSON.stringify(result)).not.toContain(second.secret);
      expect(JSON.stringify(result)).not.toContain(hashApiKey(second.secret));
    });

    it("never lists another organization's keys", async () => {
      const mine = await create(admin, { name: "mine-only", scopes: ["shipments:read"] });
      const theirs = await listApiKeys(outsider);
      if (!theirs.ok) throw new Error("unexpected failure");
      expect(theirs.keys.map((key) => key.id)).not.toContain(mine.key.id);
    });

    it("is for admins only", async () => {
      for (const ctx of [dispatcher, driver]) {
        expect(await listApiKeys(ctx)).toEqual({ ok: false, reason: "forbidden" });
      }
    });
  });

  describe("revokeApiKey", () => {
    it("revokes, idempotently keeping the first revocation time", async () => {
      const { key } = await create();
      const first = new Date("2030-01-01T00:00:00Z");

      expect(await revokeApiKey(admin, key.id, first)).toEqual({ ok: true });
      expect(await revokeApiKey(admin, key.id, new Date("2031-01-01T00:00:00Z"))).toEqual({
        ok: true,
      });
      expect((await rowOf(key.id)).revokedAt).toEqual(first);
    });

    it("does not find other organizations' keys or malformed ids, and leaves them usable", async () => {
      const { key, secret } = await create();

      expect(await revokeApiKey(outsider, key.id)).toEqual({ ok: false, reason: "not_found" });
      expect(await revokeApiKey(admin, "not-a-uuid")).toEqual({ ok: false, reason: "not_found" });
      expect(await authenticateApiKey(secret)).not.toBeNull();
    });

    it("is for admins only", async () => {
      const { key } = await create();
      for (const ctx of [dispatcher, driver]) {
        expect(await revokeApiKey(ctx, key.id)).toEqual({ ok: false, reason: "forbidden" });
      }
      expect((await rowOf(key.id)).revokedAt).toBeNull();
    });
  });

  describe("authenticateApiKey", () => {
    it("authenticates a key as an api context in the key's organization", async () => {
      const { key, secret } = await create(admin, {
        name: "auth",
        scopes: ["shipments:read", "shipments:write"],
      });

      expect(await authenticateApiKey(secret)).toEqual({
        ctx: { userId: admin.userId, organizationId: admin.organizationId, role: "api" },
        scopes: ["shipments:read", "shipments:write"],
        keyId: key.id,
      });
    });

    it("rejects missing, malformed, unknown and revoked keys alike", async () => {
      const { key, secret } = await create();
      await revokeApiKey(admin, key.id);
      const unknown = `${API_KEY_PREFIX}${"A".repeat(43)}`;

      for (const bearer of [null, "", "garbage", unknown, secret, secret.slice(0, -1)]) {
        expect(await authenticateApiKey(bearer)).toBeNull();
      }
    });

    it("writes last_used_at at most once per minute", async () => {
      const { key, secret } = await create();
      const t0 = new Date("2030-06-01T12:00:00Z");
      const at = (ms: number) => new Date(t0.getTime() + ms);

      await authenticateApiKey(secret, t0);
      expect((await rowOf(key.id)).lastUsedAt).toEqual(t0);

      await authenticateApiKey(secret, at(LAST_USED_GRANULARITY_MS - 1));
      expect((await rowOf(key.id)).lastUsedAt).toEqual(t0);

      await authenticateApiKey(secret, at(LAST_USED_GRANULARITY_MS + 1));
      expect((await rowOf(key.id)).lastUsedAt).toEqual(at(LAST_USED_GRANULARITY_MS + 1));
    });

    describe("when the creator's membership changes", () => {
      const membershipOf = (ctx: AuthContext) =>
        and(eq(member.userId, ctx.userId), eq(member.organizationId, ctx.organizationId));

      it("rejects the key once its creator is demoted from admin, and again accepts it if restored", async () => {
        const creator = await createTestContext(admin.organizationId, "admin");
        const { secret } = await create(creator);
        expect(await authenticateApiKey(secret)).not.toBeNull();

        await getDb().update(member).set({ role: "dispatcher" }).where(membershipOf(creator));
        expect(await authenticateApiKey(secret)).toBeNull();

        await getDb().update(member).set({ role: "admin" }).where(membershipOf(creator));
        expect(await authenticateApiKey(secret)).not.toBeNull();
      });

      it("rejects the key once its creator is removed from the organization", async () => {
        const creator = await createTestContext(admin.organizationId, "admin");
        const { secret } = await create(creator);

        await getDb().delete(member).where(membershipOf(creator));

        expect(await authenticateApiKey(secret)).toBeNull();
      });

      it("rejects the key when the creator is an admin only of another organization", async () => {
        const creator = await createTestContext(admin.organizationId, "admin");
        const { secret } = await create(creator);
        await getDb().delete(member).where(membershipOf(creator));
        await getDb().insert(member).values({
          id: crypto.randomUUID(),
          organizationId: outsider.organizationId,
          userId: creator.userId,
          role: "admin",
          createdAt: new Date(),
        });

        expect(await authenticateApiKey(secret)).toBeNull();
      });

      it("does not stamp last_used_at for a rejected key", async () => {
        const creator = await createTestContext(admin.organizationId, "admin");
        const { key, secret } = await create(creator);
        await getDb().delete(member).where(membershipOf(creator));

        await authenticateApiKey(secret);

        expect((await rowOf(key.id)).lastUsedAt).toBeNull();
      });
    });

    it("does not stamp a key that was revoked after the lookup", async () => {
      const { key, secret } = await create();
      await revokeApiKey(admin, key.id);
      await authenticateApiKey(secret);
      expect((await rowOf(key.id)).lastUsedAt).toBeNull();
    });
  });
});
