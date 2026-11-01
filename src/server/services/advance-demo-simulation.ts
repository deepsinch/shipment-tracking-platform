import "server-only";

import type { AuthContext } from "@/server/auth/auth-context";
import { getDemoSimulator } from "@/server/demo/demo-simulator";
import { findDemoOrganizationId } from "@/server/demo/fleet";
import { claimDemoTick } from "@/server/demo/tick-throttle";
import { env } from "@/server/env";
import type { TickReport } from "@/server/simulator/simulator";

import { forbidden, type Forbidden } from "./results";

export type AdvanceDemoSimulationResult =
  /** The simulator moved the demo trucks one tick. */
  | { ok: true; ran: true; driven: number; remaining: number }
  /** Another viewer's tick ran less than `DEMO_TICK_INTERVAL_MS` ago; nothing was done. */
  | { ok: true; ran: false; reason: "throttled" }
  /** Not a demo deployment: the endpoint behaves as if it did not exist. */
  | { ok: false; reason: "demo_disabled" }
  | Forbidden;

export type AdvanceDemoSimulationDeps = {
  now?: () => Date;
  isDemoEnabled?: () => boolean;
  demoOrganizationId?: () => Promise<string | null>;
  /** Runs one simulator tick; replaced in tests that only care about the throttle. */
  tick?: () => Promise<TickReport>;
};

/**
 * Advances the public demo's trucks by one simulator tick, for any signed-in member of the demo
 * organization. Viewers of the live map and shipment pages ask for this every few seconds (there is
 * no worker process on a serverless host); the shared throttle (`claimDemoTick`) lets one tick
 * through per interval however many ask, so trucks move at the same pace for everyone and nothing
 * runs when nobody is watching.
 *
 * Order matters: demo mode, then organization (so a stranger cannot spend the throttle), then the
 * claim, then the tick. The tick itself is the existing simulator driving the existing services as
 * each truck's driver, so every rule still applies and every change is announced on the realtime
 * stream like a real driver's.
 */
export async function advanceDemoSimulation(
  ctx: AuthContext,
  deps: AdvanceDemoSimulationDeps = {},
): Promise<AdvanceDemoSimulationResult> {
  const isDemoEnabled = deps.isDemoEnabled ?? (() => env.demo.enabled);
  if (!isDemoEnabled()) return { ok: false, reason: "demo_disabled" };

  const demoOrganizationId = await (deps.demoOrganizationId ?? findDemoOrganizationId)();
  if (demoOrganizationId === null || ctx.organizationId !== demoOrganizationId) return forbidden;

  const now = deps.now?.() ?? new Date();
  if (!(await claimDemoTick(now))) return { ok: true, ran: false, reason: "throttled" };

  const report = await (deps.tick ?? (() => getDemoSimulator().tick()))();
  return { ok: true, ran: true, driven: report.driven, remaining: report.remaining };
}
