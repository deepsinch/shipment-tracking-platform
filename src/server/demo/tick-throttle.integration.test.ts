import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { DEMO_TICK_INTERVAL_MS } from "@/domain/demo";
import type { AuthContext } from "@/server/auth/auth-context";
import { getDb } from "@/server/db/client";
import { demoTickState } from "@/server/db/schema";
import { advanceDemoSimulation } from "@/server/services/advance-demo-simulation";

import { waitForLockWaiters } from "../../../tests/integration/locks";

import { claimDemoTick } from "./tick-throttle";

/**
 * The simulator tick's global throttle. One row is shared by every test of this file, so each
 * test sets it to a known state first.
 */

const base = new Date("2030-01-01T12:00:00Z");
const at = (ms: number) => new Date(base.getTime() + ms);

async function setLastTick(date: Date | null) {
  await getDb().delete(demoTickState);
  if (date) await getDb().insert(demoTickState).values({ name: "simulator", lastTickAt: date });
}

const lastTick = async () => (await getDb().select().from(demoTickState))[0]?.lastTickAt ?? null;

describe("claimDemoTick", () => {
  it("lets the very first call through and then makes everyone wait", async () => {
    await setLastTick(null);

    expect(await claimDemoTick(at(0))).toBe(true);
    expect(await claimDemoTick(at(1))).toBe(false);
    expect(await claimDemoTick(at(DEMO_TICK_INTERVAL_MS - 1))).toBe(false);
    expect(await lastTick()).toEqual(at(0));
  });

  it("lets the next one through once the interval has passed, and restarts the interval", async () => {
    await setLastTick(at(0));

    expect(await claimDemoTick(at(DEMO_TICK_INTERVAL_MS))).toBe(true);
    expect(await lastTick()).toEqual(at(DEMO_TICK_INTERVAL_MS));
    expect(await claimDemoTick(at(DEMO_TICK_INTERVAL_MS + 1))).toBe(false);
  });

  it("lets exactly one of a burst of parallel claims through", async () => {
    await setLastTick(at(0));

    const claims = await Promise.all(
      Array.from({ length: 6 }, () => claimDemoTick(at(DEMO_TICK_INTERVAL_MS))),
    );

    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("lets exactly one of two contenders through when both are blocked on the row at once", async () => {
    await setLastTick(at(0));

    // Forced race: a third transaction holds the row, so both claims have read it as "interval
    // passed" and queue on the upsert. Once the lock is released one goes through; Postgres
    // re-evaluates the other's WHERE against the committed row and it matches nothing. A
    // read-then-write check would let both through.
    let pending: Promise<boolean[]> | undefined;
    await getDb().transaction(async (tx) => {
      await tx.execute(sql`SELECT 1 FROM demo_tick_state WHERE name = 'simulator' FOR UPDATE`);
      pending = Promise.all([
        claimDemoTick(at(DEMO_TICK_INTERVAL_MS)),
        claimDemoTick(at(DEMO_TICK_INTERVAL_MS + 1)),
      ]);
      await waitForLockWaiters(2);
    });

    expect((await pending!).sort()).toEqual([false, true]);
  });
});

describe("advanceDemoSimulation: the throttle around the tick", () => {
  const ctx: AuthContext = { userId: "u", organizationId: "demo-org", role: "dispatcher" };

  function countingDeps(now: Date) {
    const ticks: number[] = [];
    return {
      ticks,
      deps: {
        now: () => now,
        isDemoEnabled: () => true,
        demoOrganizationId: async () => "demo-org",
        tick: async () => {
          ticks.push(ticks.length);
          return { driven: 3, events: [], remaining: 2 };
        },
      },
    };
  }

  it("runs the tick for one of two simultaneous viewers, forced to collide", async () => {
    await setLastTick(at(0));
    const { ticks, deps } = countingDeps(at(DEMO_TICK_INTERVAL_MS));

    let pending: ReturnType<typeof advanceDemoSimulation>[] | undefined;
    await getDb().transaction(async (tx) => {
      await tx.execute(sql`SELECT 1 FROM demo_tick_state WHERE name = 'simulator' FOR UPDATE`);
      pending = [advanceDemoSimulation(ctx, deps), advanceDemoSimulation(ctx, deps)];
      await waitForLockWaiters(2);
    });
    const results = await Promise.all(pending!);

    expect(ticks).toHaveLength(1);
    expect(results.map((result) => ("ran" in result ? result.ran : null)).sort()).toEqual([
      false,
      true,
    ]);
    expect(results.find((result) => "reason" in result && result.ok)).toEqual({
      ok: true,
      ran: false,
      reason: "throttled",
    });
  });

  it("answers a throttled viewer without running a tick", async () => {
    await setLastTick(at(0));
    const { ticks, deps } = countingDeps(at(1000));

    expect(await advanceDemoSimulation(ctx, deps)).toEqual({
      ok: true,
      ran: false,
      reason: "throttled",
    });
    expect(ticks).toHaveLength(0);
  });

  it("does nothing, not even spend the throttle, when demo mode is off", async () => {
    await setLastTick(at(0));
    const { ticks, deps } = countingDeps(at(DEMO_TICK_INTERVAL_MS));

    expect(await advanceDemoSimulation(ctx, { ...deps, isDemoEnabled: () => false })).toEqual({
      ok: false,
      reason: "demo_disabled",
    });
    expect(ticks).toHaveLength(0);
    expect(await lastTick()).toEqual(at(0));
  });

  it("refuses members of other organizations without spending the throttle", async () => {
    await setLastTick(at(0));
    const { ticks, deps } = countingDeps(at(DEMO_TICK_INTERVAL_MS));

    expect(await advanceDemoSimulation({ ...ctx, organizationId: "someone-else" }, deps)).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(
      await advanceDemoSimulation(ctx, { ...deps, demoOrganizationId: async () => null }),
    ).toEqual({ ok: false, reason: "forbidden" });
    expect(ticks).toHaveLength(0);
    expect(await lastTick()).toEqual(at(0));
  });
});
