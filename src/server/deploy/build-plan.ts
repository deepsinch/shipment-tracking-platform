import type { ServerEnv } from "@/server/env";

/**
 * What the deploy build (`pnpm vercel-build`, `scripts/vercel-build.ts`) does, decided from the
 * validated environment. Pure, so the order and the demo-only seed are unit tested.
 *
 *   migrate  apply the committed migrations on the direct connection; a failure fails the deploy,
 *            so code never ships against an old schema
 *   seed     create Demo Freight Co, only when DEMO_MODE=true (a no-op once it exists)
 *   build    `next build`
 *
 * Environment validation runs before any step and is not part of the plan: nothing may start
 * with an invalid environment.
 */
export type BuildStep = "migrate" | "seed" | "build";

export function buildPlan(env: Pick<ServerEnv, "demo">): BuildStep[] {
  return env.demo.enabled ? ["migrate", "seed", "build"] : ["migrate", "build"];
}

/** "host/database" of a connection URL, for logs: never the user or the password. */
export function describeDatabase(url: string): string {
  const parsed = new URL(url);
  return `${parsed.host}${decodeURIComponent(parsed.pathname)}`;
}
