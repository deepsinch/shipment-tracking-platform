/**
 * e2e fixture: adds a driver to the organization of an existing admin. The app has no member
 * management UI yet, so this goes through the same Better Auth calls as the demo seed (sign-up,
 * then `addMember`), never raw SQL. Assigning the driver is left to the test, through the UI.
 *
 * Usage (see `addDriver` in helpers.ts):
 *   tsx --conditions=react-server tests/e2e/add-driver.ts <admin email> <name> <email> <password>
 */
import { eq } from "drizzle-orm";

import { getAuth } from "@/server/auth/auth";
import { closeDb, getDb } from "@/server/db/client";
import { assertDatabaseName } from "@/server/db/maintenance";
import { member, user } from "@/server/db/schema";

const [adminEmail, name, email, password] = process.argv.slice(2);
if (!adminEmail || !name || !email || !password) {
  throw new Error("Usage: add-driver.ts <admin email> <name> <email> <password>");
}
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");
assertDatabaseName(url, (db) => db.endsWith("_e2e"), "the database name must end in _e2e");

try {
  const [admin] = await getDb()
    .select({ organizationId: member.organizationId })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(user.email, adminEmail))
    .limit(1);
  if (!admin) throw new Error(`No organization found for ${adminEmail}`);

  const auth = getAuth();
  const { user: driver } = await auth.api.signUpEmail({ body: { name, email, password } });
  await auth.api.addMember({
    body: { userId: driver.id, organizationId: admin.organizationId, role: "driver" },
  });
} finally {
  await closeDb();
}
