import type { Role } from "./roles";

/**
 * Constants of the public demo (`DEMO_MODE=true`), shared by the seed, the sign-in page, the
 * banner and the tick endpoint. Pure: no I/O, importable anywhere.
 */

export const DEMO_ORGANIZATION_NAME = "Demo Freight Co";

/** Demo-only credentials, published in the README and offered as one-click sign-ins. */
export const DEMO_PASSWORD = "demo-password";

export const DEMO_USERS = [
  { role: "admin", name: "Alex Admin", email: "admin@demo.test" },
  { role: "dispatcher", name: "Dana Dispatcher", email: "dispatcher@demo.test" },
  { role: "driver", name: "Dries Driver", email: "driver@demo.test" },
] as const satisfies readonly { role: Role; name: string; email: string }[];

export type DemoUser = (typeof DEMO_USERS)[number];

/**
 * When the nightly reset is scheduled (UTC). `vercel.json` repeats the cron expression, because
 * it is a static file; a unit test keeps the two equal. Vercel's Hobby plan runs a daily job at
 * some point within the scheduled hour, hence "around" in the banner.
 */
export const DEMO_RESET_HOUR_UTC = 3;
export const DEMO_RESET_CRON = `0 ${DEMO_RESET_HOUR_UTC} * * *`;
export const DEMO_RESET_PATH = "/api/cron/reset-demo";

/** "03:00 UTC", the label shown in the banner. */
export const DEMO_RESET_LABEL = `${String(DEMO_RESET_HOUR_UTC).padStart(2, "0")}:00 UTC`;

/**
 * At most one simulator tick per this long, across every viewer and server instance. Clear of the
 * 10 s ping throttle per shipment, so a tick's pings are accepted (docs/architecture.md, "Truck
 * simulator").
 */
export const DEMO_TICK_INTERVAL_MS = 12_000;
export const DEMO_TICK_PATH = "/api/demo/tick";
