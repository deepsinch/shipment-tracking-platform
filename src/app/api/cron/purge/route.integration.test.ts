import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/server/db/client";
import { authRateLimits } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const SECRET = "a-long-enough-cron-secret";

afterEach(() => vi.unstubAllEnvs());

async function loadGet(demoMode: boolean) {
  vi.resetModules();
  vi.stubEnv("DEMO_MODE", String(demoMode));
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("DEMO_RESET_DATABASES", "unused_test");
  return (await import("./route")).GET;
}

const request = (authorization?: string) =>
  new Request("http://localhost/api/cron/purge", {
    headers: authorization === undefined ? {} : { authorization },
  });

describe("GET /api/cron/purge", () => {
  it.each([
    ["without a secret", undefined],
    ["with a wrong secret", "Bearer not-the-secret"],
    ["without the Bearer scheme", SECRET],
  ])("answers 401 %s", async (_name, header) => {
    const GET = await loadGet(false);
    expect((await GET(request(header))).status).toBe(401);
  });

  it.each([false, true])("purges with the secret (demo mode %s)", async (demoMode) => {
    const key = randomUUID();
    await getDb()
      .insert(authRateLimits)
      .values({ key, windowStart: new Date(Date.now() - 2 * 24 * 60 * 60_000), count: 1 });
    const GET = await loadGet(demoMode);

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    // The same daily call is the backstop that drains due webhook deliveries and customer emails.
    expect(await response.json()).toMatchObject({
      status: "purged",
      webhooks: {
        claimed: expect.any(Number),
        succeeded: 0,
        failed: expect.any(Number),
        dead: expect.any(Number),
      },
      emails: { claimed: expect.any(Number), sent: expect.any(Number) },
    });
    expect(await getDb().select().from(authRateLimits).where(eq(authRateLimits.key, key))).toEqual(
      [],
    );
  });
});
