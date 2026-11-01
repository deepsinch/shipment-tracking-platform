/**
 * e2e fixture: uses up the per-address sign-in allowance of one client address, through the same
 * `consumeRateLimit` the sign-in service calls, so a spec can prove a path is rate limited without
 * firing dozens of requests.
 *
 * Usage (see demo.spec.ts):
 *   tsx --conditions=react-server tests/e2e/exhaust-sign-in-limit.ts <client address>
 */
import { consumeRateLimit, RATE_LIMITS } from "@/server/auth/rate-limit";
import { closeDb } from "@/server/db/client";
import { assertDatabaseName } from "@/server/db/maintenance";

const [address] = process.argv.slice(2);
if (!address) throw new Error("Usage: exhaust-sign-in-limit.ts <client address>");
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");
assertDatabaseName(url, (db) => db.endsWith("_e2e"), "the database name must end in _e2e");

try {
  for (let attempt = 0; attempt <= RATE_LIMITS.signInPerIp.limit; attempt++) {
    await consumeRateLimit(RATE_LIMITS.signInPerIp, address);
  }
} finally {
  await closeDb();
}
