/**
 * `pnpm simulate` — drives the demo trucks so the live map moves.
 *
 * Every unfinished shipment assigned to a driver of "Demo Freight Co" is a truck. Acting as that
 * driver, through the same services as the driver app, the simulator picks up assigned shipments
 * that are still waiting at the sender, follows each road route from the committed fixture,
 * reports positions, and moves statuses along: in transit, out for delivery near the address,
 * delivered on arrival, with the odd exception on the way. Run it next to `pnpm dev` and watch
 * /dashboard/map. Only the local dev database `waybill` is accepted.
 *
 * Options:
 *   --once           one tick, then exit
 *   --speed <x>      time compression (default 30: a 12 s tick covers 6 minutes of driving)
 *   --seed <n>       PRNG seed for exceptions (default 1); same data + same seed = same run
 *   --shipments <n>  drive at most n trucks at a time
 *   --tick <s>       seconds between ticks (default 12, at least 11: pings are throttled to one
 *                    per 10 s per shipment)
 *
 * Ctrl+C stops after the current tick; a second Ctrl+C exits at once.
 * Runs with `tsx --conditions=react-server` so the `server-only` imports in services resolve.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";

import { PING_INTERVAL_MS } from "@/domain/location-sharing";
import { createRandom } from "@/lib/random";
import { resolveAuthContext, type AuthContext } from "@/server/auth/auth-context";
import { closeDb, getDb } from "@/server/db/client";
import { assertDatabaseName } from "@/server/db/maintenance";
import { member, user } from "@/server/db/schema";
import { closeRealtimeBus } from "@/server/realtime";
import { DEMO_ORGANIZATION_NAME, DEMO_USERS } from "@/server/seed/demo-seed";
import { createSimulator } from "@/server/simulator/simulator";
import { DEFAULT_SIMULATOR_CONFIG } from "@/server/simulator/truck";
import { listDrivers } from "@/server/services/list-drivers";

loadEnv({ quiet: true });

const DEV_DATABASE = "waybill";

function parseOptions() {
  const { values } = parseArgs({
    options: {
      once: { type: "boolean", default: false },
      speed: { type: "string" },
      seed: { type: "string" },
      shipments: { type: "string" },
      tick: { type: "string" },
    },
  });
  const number = (name: string, raw: string | undefined, fallback: number, min: number) => {
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min) {
      throw new Error(`--${name} must be a number of at least ${min} (got "${raw}")`);
    }
    return value;
  };
  return {
    once: values.once,
    speed: number("speed", values.speed, DEFAULT_SIMULATOR_CONFIG.timeCompression, 1),
    seed: Math.trunc(number("seed", values.seed, 1, 0)),
    shipments:
      values.shipments === undefined
        ? undefined
        : Math.trunc(number("shipments", values.shipments, 0, 1)),
    tickMs:
      number(
        "tick",
        values.tick,
        DEFAULT_SIMULATOR_CONFIG.tickMs / 1000,
        (PING_INTERVAL_MS + 1000) / 1000,
      ) * 1000,
  };
}

/** The demo organization's drivers, as the AuthContext each would get from a session. */
async function demoDrivers(): Promise<AuthContext[]> {
  const admin = DEMO_USERS[0];
  const [row] = await getDb()
    .select({ userId: user.id, organizationId: member.organizationId })
    .from(user)
    .innerJoin(member, eq(member.userId, user.id))
    .where(eq(user.email, admin.email))
    .limit(1);
  if (!row)
    throw new Error(`${DEMO_ORGANIZATION_NAME} is not seeded yet. Run \`pnpm db:seed\` first.`);

  const adminContext = await resolveAuthContext({
    userId: row.userId,
    activeOrganizationId: row.organizationId,
  });
  if (!adminContext)
    throw new Error(`${admin.email} is no longer a member of ${DEMO_ORGANIZATION_NAME}.`);
  const drivers = await listDrivers(adminContext);
  if (!drivers.ok) throw new Error(`${admin.email} may not list drivers.`);

  const contexts = await Promise.all(
    drivers.drivers.map((driver) =>
      resolveAuthContext({ userId: driver.id, activeOrganizationId: row.organizationId }),
    ),
  );
  return contexts.filter((context) => context !== null);
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env (see README).");
  assertDatabaseName(
    url,
    (name) => name === DEV_DATABASE,
    `the simulator only drives the local dev database "${DEV_DATABASE}"`,
  );
  const options = parseOptions();

  const stop = new AbortController();
  process.on("SIGINT", () => {
    if (stop.signal.aborted) process.exit(130);
    console.log("\nStopping after this tick (Ctrl+C again to quit now)…");
    stop.abort();
  });

  const drivers = await demoDrivers();
  const simulator = createSimulator({
    drivers,
    random: createRandom(options.seed),
    config: { timeCompression: options.speed, tickMs: options.tickMs },
    maxShipments: options.shipments,
    log: (line) => console.log(line),
  });
  console.log(
    `Driving ${DEMO_ORGANIZATION_NAME}'s trucks (${drivers.length} driver${drivers.length === 1 ? "" : "s"}), ` +
      `a tick every ${options.tickMs / 1000} s at ${options.speed}x. Watch /dashboard/map. Ctrl+C to stop.`,
  );

  while (!stop.signal.aborted) {
    const report = await simulator.tick();
    if (report.remaining === 0) {
      console.log(
        "Nothing left to drive: every assigned shipment is delivered (or with the office).\n" +
          "Run `pnpm db:seed --reset` for a fresh demo, or assign a driver to a new shipment.",
      );
      break;
    }
    if (options.once) break;
    try {
      await sleep(options.tickMs, undefined, { signal: stop.signal });
    } catch {
      // Aborted by Ctrl+C: the loop condition ends it.
    }
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeRealtimeBus();
    await closeDb();
  });
