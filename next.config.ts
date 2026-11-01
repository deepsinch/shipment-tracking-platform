import type { NextConfig } from "next";

import { securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // The driver app's delivery sends a photo (shrunk to about 0.5 MB in the browser, 4 MB at
    // most on the server) in the Server Action's request. Next's default is 1 MB. 4.5 MB is
    // Vercel's own request body limit, so the platform is the ceiling either way.
    serverActions: { bodySizeLimit: "4.5mb" },
  },
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
