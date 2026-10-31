import { resetDatabase } from "../support/database";
import { testDatabaseUrl } from "./test-database";

/**
 * Runs once before the integration project: wipes the test database and applies every committed
 * migration, so tests always run against exactly what `pnpm db:migrate` would produce.
 */
export default async function setup(): Promise<void> {
  // testDatabaseUrl() refuses any database whose name does not end in _test.
  const url = testDatabaseUrl();
  try {
    await resetDatabase(url);
  } catch (error) {
    throw new Error(
      "Could not prepare the test database. Is Postgres running (service postgresql start)?",
      { cause: error },
    );
  }
}
