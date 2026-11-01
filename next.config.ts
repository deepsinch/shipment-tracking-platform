import type { NextConfig } from "next";

import { securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // The nightly demo reset applies the committed migrations at runtime. The SQL files are read from
  // disk, not imported, so the function's trace would not include them without this.
  outputFileTracingIncludes: {
    "/api/cron/reset-demo": ["./src/server/db/migrations/**/*"],
  },
  // Security headers on every response, pages, API routes and static files alike. The policy and
  // its tradeoffs are documented in src/lib/security-headers.ts. Vercel adds HSTS.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({ dev: process.env.NODE_ENV === "development" }),
      },
    ];
  },
};

export default nextConfig;
