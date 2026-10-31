import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Vite 8 understands the "@/*" alias from tsconfig.json natively.
    tsconfigPaths: true,
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          environment: "node",
        },
      },
    ],
  },
});
