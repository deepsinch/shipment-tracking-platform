import "server-only";

import { z } from "zod";

import { resolveAuthUrls, type AuthUrlSource } from "./auth/base-url";

/**
 * Runtime environment for the app, validated with Zod.
 *
 * Validation is lazy: each group (database, auth, realtime, demo, webhooks) is parsed the first time code
 * reads it, and cached. Importing this module never throws, so `next build` and modules that are
 * only imported (never run) work without any environment variables. A missing or malformed
 * variable fails the first request that needs it, with a message naming the variable (never its
 * value: some are secrets).
 *
 * Scripts and test setups keep their own `process.env` reads: they run outside the app and often
 * point `DATABASE_URL` at another database on purpose.
 */

export class EnvError extends Error {
  override name = "EnvError";
}

type Source = Record<string, string | undefined>;

/** Unset and blank are the same thing (`.env.example` lists optional variables with no value). */
const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().optional(),
);

const postgresUrl = z
  .string({ error: "is required" })
  .trim()
  .min(1, { error: "is required", abort: true })
  .refine((value) => /^postgres(ql)?:\/\//.test(value) && URL.canParse(value), {
    error: "must be a postgres:// or postgresql:// URL",
  });

const optionalPostgresUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  postgresUrl.optional(),
);

/** Better Auth signs session cookies with this; `openssl rand -base64 32` gives 44 characters. */
export const MIN_AUTH_SECRET_LENGTH = 32;

const databaseSchema = z
  .object({
    DATABASE_URL: postgresUrl,
    DATABASE_DIRECT_URL: optionalPostgresUrl,
    // The name the Neon integration on Vercel gives the direct (unpooled) connection.
    DATABASE_URL_UNPOOLED: optionalPostgresUrl,
  })
  .transform((env) => ({
    /** Pooled connection for queries and transactions. */
    url: env.DATABASE_URL,
    /**
     * Direct (session) connection, for `LISTEN` and migrations, which a transaction-mode pooler
     * cannot serve. Without a pooler (locally) it is the same as `url`.
     */
    directUrl: env.DATABASE_DIRECT_URL ?? env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL,
  }));

const authSchema = z
  .object({
    BETTER_AUTH_SECRET: z
      .string({ error: "is required" })
      .min(1, { error: "is required", abort: true })
      .min(
        MIN_AUTH_SECRET_LENGTH,
        `must be at least ${MIN_AUTH_SECRET_LENGTH} characters (generate one with: openssl rand -base64 32)`,
      ),
    // Optional on Vercel, where the origin is derived (see `resolveAuthUrls`); the resolver says
    // when it is still required.
    BETTER_AUTH_URL: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      z
        .string()
        .trim()
        .refine((value) => /^https?:\/\//.test(value) && URL.canParse(value), {
          error: "must be an http:// or https:// URL (the app's public origin)",
        })
        .optional(),
    ),
    // Vercel's system environment variables (set by the platform, never by hand).
    VERCEL: optionalString,
    VERCEL_ENV: optionalString,
    VERCEL_PROJECT_PRODUCTION_URL: optionalString,
    VERCEL_BRANCH_URL: optionalString,
    VERCEL_URL: optionalString,
  })
  // A refinement (not only the transform) so that `validateEnv` reports an unresolvable origin
  // together with a missing secret: `when` runs it even though another field already failed.
  .refine((env) => resolveAuthUrls(env).ok, {
    path: ["BETTER_AUTH_URL"],
    error: (issue) => {
      const urls = resolveAuthUrls(issue.input as AuthUrlSource);
      return urls.ok ? undefined : urls.message;
    },
    when: () => true,
  })
  .transform((env) => {
    const urls = resolveAuthUrls(env);
    if (!urls.ok) throw new Error("unreachable: the refinement above rejects unresolvable URLs");
    return { secret: env.BETTER_AUTH_SECRET, url: urls.url, trustedOrigins: urls.trustedOrigins };
  });

const realtimeSchema = z
  .object({
    REALTIME_STREAM_SECONDS: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      z.coerce
        .number({ error: "must be a number of seconds" })
        .int("must be a whole number of seconds")
        .positive("must be a positive number of seconds")
        .optional(),
    ),
  })
  .transform((env) => ({ streamSeconds: env.REALTIME_STREAM_SECONDS }));

/** CRON_SECRET guards a database wipe: long enough that guessing it is hopeless. */
export const MIN_CRON_SECRET_LENGTH = 16;

const demoSchema = z
  .object({
    DEMO_MODE: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      z.enum(["true", "false"], { error: 'must be "true" or "false"' }).optional(),
    ),
    CRON_SECRET: optionalString,
    DEMO_RESET_DATABASES: optionalString,
  })
  .superRefine((env, ctx) => {
    if (env.DEMO_MODE !== "true") return;
    if (!env.CRON_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["CRON_SECRET"],
        message: "is required when DEMO_MODE=true (it guards the nightly demo reset)",
      });
    } else if (env.CRON_SECRET.length < MIN_CRON_SECRET_LENGTH) {
      ctx.addIssue({
        code: "custom",
        path: ["CRON_SECRET"],
        message: `must be at least ${MIN_CRON_SECRET_LENGTH} characters (generate one with: openssl rand -base64 32)`,
      });
    }
    if (!env.DEMO_RESET_DATABASES) {
      ctx.addIssue({
        code: "custom",
        path: ["DEMO_RESET_DATABASES"],
        message:
          "is required when DEMO_MODE=true: the name of the database the nightly reset may wipe " +
          "(comma-separated for several), e.g. neondb",
      });
    }
  })
  .transform((env) => ({
    enabled: env.DEMO_MODE === "true",
    cronSecret: env.CRON_SECRET,
    /**
     * Databases the demo reset is allowed to wipe, by name. An explicit allow-list instead of a
     * hard-coded name (hosts name databases differently: `neondb` on Neon), so a wipe can only
     * ever hit a database the owner named on purpose.
     */
    resetDatabases: (env.DEMO_RESET_DATABASES ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== ""),
  }));

const webhooksSchema = z
  .object({
    WEBHOOKS_ALLOW_LOCAL_TARGETS: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      z.enum(["true", "false"], { error: 'must be "true" or "false"' }).optional(),
    ),
    // Read only to refuse the flag where it must never be on.
    VERCEL: optionalString,
    DEMO_MODE: optionalString,
  })
  .superRefine((env, ctx) => {
    if (env.WEBHOOKS_ALLOW_LOCAL_TARGETS !== "true") return;
    if (env.VERCEL || env.DEMO_MODE === "true") {
      ctx.addIssue({
        code: "custom",
        path: ["WEBHOOKS_ALLOW_LOCAL_TARGETS"],
        message:
          "must not be set on Vercel or in demo mode: it lets webhooks reach localhost " +
          "(development and tests only)",
      });
    }
  })
  .transform((env) => ({
    /**
     * Development and tests only: lets webhook URLs point at http://localhost, so a test
     * receiver on the same machine works. Private ranges and cloud metadata addresses stay
     * refused. Rejected on Vercel and in demo mode (see `superRefine`), so a hosted deployment
     * cannot be talked into reaching its own network.
     */
    allowLocalTargets: env.WEBHOOKS_ALLOW_LOCAL_TARGETS === "true",
  }));

const groups = {
  database: databaseSchema,
  auth: authSchema,
  realtime: realtimeSchema,
  demo: demoSchema,
  webhooks: webhooksSchema,
};

type Groups = typeof groups;
export type ServerEnv = { readonly [K in keyof Groups]: z.output<Groups[K]> };

/** One line per problem, each naming the variable: "BETTER_AUTH_SECRET is required". */
function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".") || "environment"} ${issue.message}`);
}

function parseGroup<K extends keyof Groups>(name: K, source: Source): z.output<Groups[K]> {
  const result = groups[name].safeParse(source);
  if (!result.success) {
    throw new EnvError(
      `Invalid environment: ${describeIssues(result.error).join("; ")}. ` +
        "See .env.example for every variable the app reads.",
    );
  }
  return result.data as z.output<Groups[K]>;
}

/**
 * The environment read from `source`, each group validated on first access and then cached.
 * `createEnv` itself never throws.
 */
export function createEnv(source: Source): ServerEnv {
  const cache = new Map<keyof Groups, unknown>();
  const lazy =
    <K extends keyof Groups>(name: K) =>
    (): z.output<Groups[K]> => {
      if (!cache.has(name)) cache.set(name, parseGroup(name, source));
      return cache.get(name) as z.output<Groups[K]>;
    };
  return Object.defineProperties({} as ServerEnv, {
    database: { get: lazy("database"), enumerable: true },
    auth: { get: lazy("auth"), enumerable: true },
    realtime: { get: lazy("realtime"), enumerable: true },
    demo: { get: lazy("demo"), enumerable: true },
    webhooks: { get: lazy("webhooks"), enumerable: true },
  });
}

/**
 * Validates every group at once and reports all problems together (a deploy step wants the full
 * list, not the first failure). Throws an `EnvError`; returns the parsed environment otherwise.
 */
export function validateEnv(source: Source): ServerEnv {
  const problems: string[] = [];
  const parsed: Record<string, unknown> = {};
  for (const name of Object.keys(groups) as (keyof Groups)[]) {
    const result = groups[name].safeParse(source);
    if (result.success) parsed[name] = result.data;
    else problems.push(...describeIssues(result.error));
  }
  if (problems.length > 0) {
    throw new EnvError(
      `Invalid environment:\n${problems.map((problem) => `  - ${problem}`).join("\n")}\n` +
        "See .env.example for every variable the app reads.",
    );
  }
  return parsed as ServerEnv;
}

/** The app's environment, read from `process.env` (validated lazily, per group). */
export const env: ServerEnv = createEnv(process.env);
