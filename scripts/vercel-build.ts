/**
 * `pnpm vercel-build` — the production build on Vercel (vercel.json points the build command here).
 *
 * In order, stopping at the first failure so a broken deploy never goes live:
 *   1. validate the whole environment, listing every problem at once
 *   2. migrate the database on the direct (unpooled) connection
 *   3. seed Demo Freight Co, only when DEMO_MODE=true (a no-op once it exists)
 *   4. `next build`
 *
 * Migrations run while the previous release may still serve traffic, so every migration must be
 * backward compatible with it (expand now, contract in a later release).
 *
 * Reads the environment as given, never a `.env` file: on Vercel it is the project's variables.
 * To try it locally, pass them on the command line (see docs/deployment.md, "Test the build").
 * Runs with `tsx --conditions=react-server` so the `server-only` imports of the seed resolve.
 */
import { spawn } from "node:child_process";

import { buildPlan, describeDatabase, type BuildStep } from "@/server/deploy/build-plan";
import { closeDb } from "@/server/db/client";
import { migrateDatabase } from "@/server/db/maintenance";
import { checkResetAllowed } from "@/server/demo/reset-demo";
import { EnvError, validateEnv, type ServerEnv } from "@/server/env";
import { seedDemo } from "@/server/seed/demo-seed";

function runNextBuild(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "next", "build"], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) =>
      code === 0
        ? resolve()
        : reject(new Error(`next build failed (${signal ?? `exit code ${code}`})`)),
    );
  });
}

async function run(step: BuildStep, env: ServerEnv): Promise<void> {
  switch (step) {
    case "migrate":
      console.log(`Migrating ${describeDatabase(env.database.directUrl)} (direct connection)`);
      await migrateDatabase(env.database.directUrl);
      return;
    case "seed": {
      const result = await seedDemo();
      console.log(
        result.status === "seeded"
          ? `Seeded ${result.shipmentCount} shipments for Demo Freight Co`
          : `Demo data already present (${result.reason}); nothing to do`,
      );
      return;
    }
    case "build":
      await runNextBuild();
      return;
  }
}

async function main(): Promise<void> {
  console.log("▸ validate environment");
  const env = validateEnv(process.env);
  console.log(
    `  database ${describeDatabase(env.database.url)}, auth URL ${env.auth.url}, ` +
      `demo mode ${env.demo.enabled ? "on" : "off"}`,
  );

  if (env.demo.enabled) {
    // Fail the deploy now rather than at the first nightly reset.
    const check = checkResetAllowed({
      directUrl: env.database.directUrl,
      poolUrl: env.database.url,
      allowedDatabases: env.demo.resetDatabases,
    });
    if (!check.ok) throw new EnvError(`Demo mode cannot reset this database. ${check.message}`);
  }

  for (const step of buildPlan(env)) {
    console.log(`\n▸ ${step}`);
    const started = Date.now();
    await run(step, env);
    console.log(`✓ ${step} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(`\n✗ vercel-build failed\n${error instanceof Error ? error.message : error}`);
    if (!(error instanceof EnvError) && error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exitCode = 1;
  })
  .finally(() => closeDb());
