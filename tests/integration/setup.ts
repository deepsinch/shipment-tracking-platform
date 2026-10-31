import { afterAll } from "vitest";

import { closeDb } from "@/server/db/client";
import { closeRealtimeBus } from "@/server/realtime";

// Each test file gets its own module graph and therefore its own pool (and realtime listener, if
// the file used one); close them when done.
afterAll(async () => {
  await closeRealtimeBus();
  await closeDb();
});
