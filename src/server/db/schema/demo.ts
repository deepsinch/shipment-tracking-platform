import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * When the public demo's simulator last ran, one row per named clock (only `simulator` exists).
 * It is the shared throttle behind `/api/demo/tick`: a conditional upsert on this row lets at most
 * one tick through per interval, whatever the number of viewers and server instances (see
 * `src/server/demo/tick-throttle.ts`). Not history: the row is overwritten on every tick and may
 * be deleted freely.
 */
export const demoTickState = pgTable("demo_tick_state", {
  name: text("name").primaryKey(),
  lastTickAt: timestamp("last_tick_at", { withTimezone: true, mode: "date" }).notNull(),
});
