import path from "node:path";

import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

// Integration tests read TEST_DATABASE_URL from .env (see .env.example).
loadEnv({ quiet: true });

export default defineConfig({
  resolve: {
    // Vite 8 understands the "@/*" alias from tsconfig.json natively.
    tsconfigPaths: true,
    alias: {
      "server-only": path.resolve(import.meta.dirname, "tests/server-only-stub.ts"),
    },
  },
  test: {
    // `pnpm test:coverage`: unit and integration tests together, source files only. Not a CI gate;
    // e2e specs cover the UI, which is why components and pages are left out of the numbers.
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.ts",
        "src/components/**",
        "src/app/**/*.tsx",
        "src/server/db/migrations/**",
        "**/*.d.ts",
      ],
      reporter: ["text-summary", "text"],
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.integration.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["src/**/*.integration.test.ts"],
          environment: "node",
          globalSetup: ["tests/integration/global-setup.ts"],
          setupFiles: ["tests/integration/setup.ts"],
          // Code under test uses DATABASE_URL (and the realtime listener DATABASE_DIRECT_URL);
          // point both at the test database.
          env: {
            DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
            DATABASE_DIRECT_URL: process.env.TEST_DATABASE_URL ?? "",
          },
          // One shared database: run files one at a time.
          fileParallelism: false,
          testTimeout: 15_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
