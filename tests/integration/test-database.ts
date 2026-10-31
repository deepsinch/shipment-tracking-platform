/**
 * Resolves the integration-test database URL and refuses anything that does not look like a
 * throwaway test database, because the global setup drops and recreates its schema.
 */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Integration tests need Postgres running and a .env file " +
        "(copy .env.example; see README).",
    );
  }
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) {
    throw new Error(
      `Refusing to run integration tests against "${name}": the database name must end in _test.`,
    );
  }
  return url;
}
