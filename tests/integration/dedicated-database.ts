import { randomUUID } from "node:crypto";

import { ensureDatabaseExists, migrateDatabase } from "../../src/server/db/maintenance";
import { signUpWithOrganization } from "../../src/server/auth/sign-up";
import { getAuth } from "../../src/server/auth/auth";
import { testDatabaseUrl } from "./test-database";

/**
 * A second throwaway database for tests that wipe or seed a whole database (the demo reset, the
 * demo tick): the main test database's other files rely on it not being wiped, and on
 * `admin@demo.test` not existing yet. Named after `TEST_DATABASE_URL`'s with a suffix, so it still
 * ends in `_test`, created on first use (the role has CREATEDB, see `.env.example`) and migrated every time.
 *
 * Call it before the first query of the file: it points `DATABASE_URL` and `DATABASE_DIRECT_URL`
 * (what the code under test reads, lazily) at the dedicated database and returns its URL. Vitest
 * gives every file its own module graph, so other files are unaffected.
 */
export async function useDedicatedDatabase(suffix: string): Promise<string> {
  const url = new URL(testDatabaseUrl());
  url.pathname = `/${url.pathname.replace(/^\//, "").replace(/_test$/, "")}_${suffix}_test`;
  await ensureDatabaseExists(url.toString());
  await migrateDatabase(url.toString()); // brings an older run's database up to date
  process.env.DATABASE_URL = url.toString();
  process.env.DATABASE_DIRECT_URL = url.toString();
  return url.toString();
}

const PASSWORD = "correct-horse-battery";

/** The `Cookie` header of a new session for `email`, from a real Better Auth sign-in. */
export async function sessionHeaders(email: string, password = PASSWORD): Promise<Headers> {
  const { headers } = await getAuth().api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const cookie = headers
    .getSetCookie()
    .map((setCookie) => setCookie.split(";")[0])
    .join("; ");
  return new Headers({ cookie });
}

/** A signed-in admin of a brand-new organization (not the demo's). */
export async function signedInStranger(): Promise<Headers> {
  const email = `${randomUUID()}@example.test`;
  const result = await signUpWithOrganization({
    name: "Stranger Admin",
    email,
    password: PASSWORD,
    organizationName: "Demo Freight Co", // the same name on purpose: the name proves nothing
  });
  if (!result.ok) throw new Error(`sign-up failed: ${JSON.stringify(result)}`);
  return sessionHeaders(email);
}
