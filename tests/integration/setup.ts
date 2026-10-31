import { afterAll } from "vitest";

import { closeDb } from "@/server/db/client";

// Each test file gets its own module graph and therefore its own pool; close it when done.
afterAll(async () => {
  await closeDb();
});
