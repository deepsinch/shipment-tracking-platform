import { check, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Fixed-window counters for the sign-in and sign-up rate limits (see
 * `src/server/auth/rate-limit.ts`). In Postgres rather than in memory so every app instance shares
 * one count. Not history: rows are overwritten when a window restarts and may be deleted freely.
 */
export const authRateLimits = pgTable(
  "auth_rate_limits",
  {
    /** SHA-256 of rule name + subject (e.g. email and IP), so no email or IP is stored in clear. */
    key: text("key").primaryKey(),
    windowStart: timestamp("window_start", { withTimezone: true, mode: "date" }).notNull(),
    count: integer("count").notNull(),
  },
  (table) => [
    // For purging expired windows.
    index("auth_rate_limits_window_start_idx").on(table.windowStart),
    check("auth_rate_limits_count_positive", sql`${table.count} >= 1`),
  ],
);
