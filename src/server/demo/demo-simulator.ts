import "server-only";

import { createRandom } from "@/lib/random";
import { createSimulator, type Simulator } from "@/server/simulator/simulator";

import { resolveDemoDrivers } from "./fleet";

/**
 * The simulator the tick endpoint advances: one per server instance, created on first use. It
 * remembers each truck's distance along its route between ticks; a fresh instance (a cold start,
 * or another instance taking the tick) picks every truck up from its last stored position, so the
 * trucks never jump. Drivers are resolved on every tick, because the nightly reset recreates them.
 */
const globalForSimulator = globalThis as typeof globalThis & { waybillDemoSimulator?: Simulator };

export function getDemoSimulator(): Simulator {
  globalForSimulator.waybillDemoSimulator ??= createSimulator({
    drivers: resolveDemoDrivers,
    random: createRandom(Date.now() % 100_000),
  });
  return globalForSimulator.waybillDemoSimulator;
}
