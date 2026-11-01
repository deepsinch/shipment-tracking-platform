import { describe, expect, it } from "vitest";

import { createEnv, EnvError, validateEnv } from "./env";

const DB = "postgres://waybill:waybill@localhost:5432/waybill";
const POOLED = "postgresql://app:pw@ep-cool-name-pooler.eu-central-1.aws.neon.tech/neondb";
const UNPOOLED = "postgresql://app:pw@ep-cool-name.eu-central-1.aws.neon.tech/neondb";
const SECRET = "x".repeat(44);

const valid = {
  DATABASE_URL: DB,
  BETTER_AUTH_SECRET: SECRET,
  BETTER_AUTH_URL: "http://localhost:3000",
};

describe("createEnv", () => {
  it("never throws on creation, even with nothing set", () => {
    expect(() => createEnv({})).not.toThrow();
  });

  it("validates a group only when it is read", () => {
    const env = createEnv({ DATABASE_URL: DB });
    expect(env.database.url).toBe(DB);
    expect(() => env.auth).toThrow(EnvError);
  });

  it("reads the source on first access and caches the result", () => {
    const source: Record<string, string | undefined> = {};
    const env = createEnv(source);
    source.DATABASE_URL = DB;
    expect(env.database.url).toBe(DB);
    source.DATABASE_URL = "postgres://other@localhost/other";
    expect(env.database.url).toBe(DB);
  });

  it("names the missing variable, not its value", () => {
    const env = createEnv({ BETTER_AUTH_URL: "http://localhost:3000" });
    expect(() => env.auth).toThrow(/BETTER_AUTH_SECRET is required/);
    // One message per problem: a missing value is not also reported as a malformed URL.
    expect(() => env.database).toThrow(
      "Invalid environment: DATABASE_URL is required. See .env.example",
    );
  });

  it("does not echo a rejected secret", () => {
    const env = createEnv({ ...valid, BETTER_AUTH_SECRET: "short-secret-value" });
    expect(() => env.auth).toThrow(/BETTER_AUTH_SECRET must be at least 32 characters/);
    expect(() => env.auth).not.toThrow(/short-secret-value/);
  });
});

describe("database", () => {
  it("uses DATABASE_URL for the direct connection when nothing else is set (local Postgres)", () => {
    expect(createEnv(valid).database).toEqual({ url: DB, directUrl: DB });
  });

  it("falls back to DATABASE_URL_UNPOOLED, the Neon integration's name, for the direct URL", () => {
    const env = createEnv({ DATABASE_URL: POOLED, DATABASE_URL_UNPOOLED: UNPOOLED });
    expect(env.database).toEqual({ url: POOLED, directUrl: UNPOOLED });
  });

  it("prefers DATABASE_DIRECT_URL over DATABASE_URL_UNPOOLED", () => {
    const direct = "postgres://app:pw@db.internal:5432/waybill";
    const env = createEnv({
      DATABASE_URL: POOLED,
      DATABASE_DIRECT_URL: direct,
      DATABASE_URL_UNPOOLED: UNPOOLED,
    });
    expect(env.database.directUrl).toBe(direct);
  });

  it("treats a blank optional URL as unset (as listed in .env.example)", () => {
    const env = createEnv({
      DATABASE_URL: DB,
      DATABASE_DIRECT_URL: "",
      DATABASE_URL_UNPOOLED: " ",
    });
    expect(env.database.directUrl).toBe(DB);
  });

  it("rejects a URL that is not Postgres", () => {
    expect(() => createEnv({ DATABASE_URL: "mysql://localhost/db" }).database).toThrow(
      /DATABASE_URL must be a postgres:\/\/ or postgresql:\/\/ URL/,
    );
    expect(
      () => createEnv({ DATABASE_URL: DB, DATABASE_URL_UNPOOLED: "localhost:5432" }).database,
    ).toThrow(/DATABASE_URL_UNPOOLED must be a postgres/);
  });
});

describe("auth", () => {
  it("returns the secret and the public origin", () => {
    expect(createEnv(valid).auth).toEqual({
      secret: SECRET,
      url: "http://localhost:3000",
      trustedOrigins: ["http://localhost:3000"],
    });
  });

  it("accepts a secret of exactly the minimum length", () => {
    expect(createEnv({ ...valid, BETTER_AUTH_SECRET: "x".repeat(32) }).auth.secret).toHaveLength(
      32,
    );
    expect(() => createEnv({ ...valid, BETTER_AUTH_SECRET: "x".repeat(31) }).auth).toThrow(
      EnvError,
    );
  });

  it("requires BETTER_AUTH_URL to be an http(s) URL", () => {
    expect(() => createEnv({ ...valid, BETTER_AUTH_URL: "waybill.example" }).auth).toThrow(
      /BETTER_AUTH_URL must be an http/,
    );
    expect(() => createEnv({ ...valid, BETTER_AUTH_URL: undefined }).auth).toThrow(
      /BETTER_AUTH_URL is required/,
    );
  });

  it("derives the origin on Vercel, where BETTER_AUTH_URL is optional", () => {
    const onVercel = {
      BETTER_AUTH_SECRET: SECRET,
      VERCEL: "1",
      VERCEL_ENV: "preview",
      VERCEL_BRANCH_URL: "waybill-git-x-team.vercel.app",
      VERCEL_URL: "waybill-abc-team.vercel.app",
    };
    expect(createEnv(onVercel).auth).toEqual({
      secret: SECRET,
      url: "https://waybill-git-x-team.vercel.app",
      trustedOrigins: [
        "https://waybill-git-x-team.vercel.app",
        "https://waybill-abc-team.vercel.app",
      ],
    });
    // Still validated when given.
    expect(() => createEnv({ ...onVercel, BETTER_AUTH_URL: "waybill.example" }).auth).toThrow(
      /BETTER_AUTH_URL must be an http/,
    );
  });
});

describe("realtime", () => {
  it("leaves the stream lifetime unset by default", () => {
    expect(createEnv({}).realtime).toEqual({ streamSeconds: undefined });
    expect(createEnv({ REALTIME_STREAM_SECONDS: "" }).realtime.streamSeconds).toBeUndefined();
  });

  it("parses REALTIME_STREAM_SECONDS", () => {
    expect(createEnv({ REALTIME_STREAM_SECONDS: "120" }).realtime.streamSeconds).toBe(120);
  });

  it("rejects a value that is not a positive whole number", () => {
    for (const value of ["soon", "0", "-5", "12.5"]) {
      expect(() => createEnv({ REALTIME_STREAM_SECONDS: value }).realtime).toThrow(
        /REALTIME_STREAM_SECONDS must be/,
      );
    }
  });
});

describe("demo", () => {
  it("is off unless DEMO_MODE is true", () => {
    expect(createEnv({}).demo).toEqual({
      enabled: false,
      cronSecret: undefined,
      resetDatabases: [],
    });
    expect(createEnv({ DEMO_MODE: "false" }).demo.enabled).toBe(false);
  });

  const DEMO = {
    DEMO_MODE: "true",
    CRON_SECRET: "a-long-enough-cron-secret",
    DEMO_RESET_DATABASES: "neondb",
  };

  it("requires CRON_SECRET when DEMO_MODE=true", () => {
    expect(() => createEnv({ ...DEMO, CRON_SECRET: undefined }).demo).toThrow(
      /CRON_SECRET is required when DEMO_MODE=true/,
    );
    expect(createEnv(DEMO).demo).toEqual({
      enabled: true,
      cronSecret: "a-long-enough-cron-secret",
      resetDatabases: ["neondb"],
    });
  });

  it("rejects a short CRON_SECRET without echoing it", () => {
    const read = () => createEnv({ ...DEMO, CRON_SECRET: "s3cret" }).demo;
    expect(read).toThrow(/CRON_SECRET must be at least 16 characters/);
    expect(read).not.toThrow(/s3cret/);
  });

  it("requires the reset allow-list when DEMO_MODE=true, and parses it", () => {
    expect(() => createEnv({ ...DEMO, DEMO_RESET_DATABASES: "" }).demo).toThrow(
      /DEMO_RESET_DATABASES is required when DEMO_MODE=true/,
    );
    expect(
      createEnv({ ...DEMO, DEMO_RESET_DATABASES: " neondb , waybill_demo ," }).demo.resetDatabases,
    ).toEqual(["neondb", "waybill_demo"]);
  });

  it("asks for neither when demo mode is off", () => {
    expect(createEnv({ CRON_SECRET: "x" }).demo.enabled).toBe(false);
  });

  it("rejects anything but true or false", () => {
    expect(() => createEnv({ DEMO_MODE: "yes" }).demo).toThrow(
      /DEMO_MODE must be "true" or "false"/,
    );
  });
});

describe("webhooks", () => {
  it("refuses local targets by default", () => {
    expect(createEnv({}).webhooks).toEqual({ allowLocalTargets: false });
    expect(createEnv({ WEBHOOKS_ALLOW_LOCAL_TARGETS: "" }).webhooks.allowLocalTargets).toBe(false);
    expect(createEnv({ WEBHOOKS_ALLOW_LOCAL_TARGETS: "false" }).webhooks.allowLocalTargets).toBe(
      false,
    );
  });

  it("allows them when switched on locally", () => {
    expect(createEnv({ WEBHOOKS_ALLOW_LOCAL_TARGETS: "true" }).webhooks.allowLocalTargets).toBe(
      true,
    );
  });

  it("refuses the flag on Vercel and in demo mode, so a hosted app cannot reach localhost", () => {
    const flag = { WEBHOOKS_ALLOW_LOCAL_TARGETS: "true" };
    expect(() => createEnv({ ...flag, VERCEL: "1" }).webhooks).toThrow(
      /WEBHOOKS_ALLOW_LOCAL_TARGETS must not be set on Vercel or in demo mode/,
    );
    expect(() => createEnv({ ...flag, DEMO_MODE: "true" }).webhooks).toThrow(
      /WEBHOOKS_ALLOW_LOCAL_TARGETS must not be set/,
    );
  });

  it("rejects anything but true or false", () => {
    expect(() => createEnv({ WEBHOOKS_ALLOW_LOCAL_TARGETS: "yes" }).webhooks).toThrow(
      /WEBHOOKS_ALLOW_LOCAL_TARGETS must be "true" or "false"/,
    );
  });
});

describe("validateEnv", () => {
  it("returns every group for a valid environment", () => {
    const env = validateEnv(valid);
    expect(env.database.url).toBe(DB);
    expect(env.auth.url).toBe("http://localhost:3000");
    expect(env.demo.enabled).toBe(false);
  });

  it("lists every problem at once", () => {
    let message = "";
    try {
      validateEnv({ DEMO_MODE: "true" });
    } catch (error) {
      expect(error).toBeInstanceOf(EnvError);
      message = (error as Error).message;
    }
    expect(message).toContain("DATABASE_URL is required");
    expect(message).toContain("BETTER_AUTH_SECRET is required");
    expect(message).toContain("BETTER_AUTH_URL is required");
    expect(message).toContain("CRON_SECRET is required when DEMO_MODE=true");
    expect(message).toContain("DEMO_RESET_DATABASES is required when DEMO_MODE=true");
  });
});
