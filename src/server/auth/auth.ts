import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { asc, eq } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import { env } from "@/server/env";

import { organizationPlugin, sharedAuthOptions } from "./options";

function createAuth() {
  const db = getDb();
  return betterAuth({
    ...sharedAuthOptions,
    // Passed explicitly (Better Auth would also read them from process.env) so they go through
    // the validated environment: a missing or short secret fails with a clear message.
    secret: env.auth.secret,
    baseURL: env.auth.url,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    databaseHooks: {
      session: {
        create: {
          // Every session starts in the user's organization. Users belong to one organization in
          // Phase 1; if they ever belong to several, the oldest membership wins.
          before: async (session) => {
            const [membership] = await db
              .select({ organizationId: schema.member.organizationId })
              .from(schema.member)
              .where(eq(schema.member.userId, session.userId))
              .orderBy(asc(schema.member.createdAt))
              .limit(1);
            return {
              data: { ...session, activeOrganizationId: membership?.organizationId ?? null },
            };
          },
        },
      },
    },
    // nextCookies must be the last plugin: it writes Set-Cookie headers from Server Actions.
    plugins: [organizationPlugin, nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

// Created lazily (like the DB pool) so importing this module needs no env vars at build time.
const globalForAuth = globalThis as typeof globalThis & { waybillAuth?: Auth };

export function getAuth(): Auth {
  globalForAuth.waybillAuth ??= createAuth();
  return globalForAuth.waybillAuth;
}
