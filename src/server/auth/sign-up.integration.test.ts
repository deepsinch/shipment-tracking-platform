import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createTestOrganization, createTestUser } from "../../../tests/integration/fixtures";
import { getDb } from "../db/client";
import { member, organization, user } from "../db/schema";
import { getAuth } from "./auth";
import { resolveAuthContext } from "./auth-context";
import { signUpWithOrganization } from "./sign-up";

const password = "correct-horse-battery";
const uniqueEmail = () => `${randomUUID()}@example.test`;

/** Signs in through Better Auth and returns request headers carrying the session cookie. */
async function signIn(email: string): Promise<Headers> {
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

describe("signUpWithOrganization", () => {
  it("creates the user and a new organization where they are admin", async () => {
    const email = uniqueEmail();
    const result = await signUpWithOrganization({
      name: "Dana Dispatch",
      email,
      password,
      organizationName: "Northwind Haulage",
    });
    if (!result.ok) throw new Error(`sign-up failed: ${JSON.stringify(result)}`);

    const db = getDb();
    const [org] = await db
      .select()
      .from(organization)
      .where(eq(organization.id, result.organizationId));
    expect(org?.name).toBe("Northwind Haulage");
    expect(org?.slug).toMatch(/^northwind-haulage-[0-9a-f]{8}$/);

    const memberships = await db.select().from(member).where(eq(member.userId, result.userId));
    expect(memberships).toEqual([
      expect.objectContaining({ organizationId: result.organizationId, role: "admin" }),
    ]);
  });

  it("starts the next session in the new organization and resolves the admin AuthContext", async () => {
    const email = uniqueEmail();
    const result = await signUpWithOrganization({
      name: "Avery Admin",
      email,
      password,
      organizationName: "Contoso Freight",
    });
    if (!result.ok) throw new Error("sign-up failed");

    const session = await getAuth().api.getSession({ headers: await signIn(email) });
    expect(session?.session.activeOrganizationId).toBe(result.organizationId);

    const context = await resolveAuthContext({
      userId: session!.user.id,
      activeOrganizationId: session!.session.activeOrganizationId,
    });
    expect(context).toEqual({
      userId: result.userId,
      organizationId: result.organizationId,
      role: "admin",
    });
  });

  it("normalizes the email and rejects a duplicate account", async () => {
    const email = uniqueEmail();
    const input = { name: "Sam", email, password, organizationName: "First Co" };
    expect((await signUpWithOrganization(input)).ok).toBe(true);

    const duplicate = await signUpWithOrganization({ ...input, email: email.toUpperCase() });
    expect(duplicate).toEqual({
      ok: false,
      fieldErrors: { email: ["An account with this email already exists"] },
    });
  });

  it("returns field errors for invalid input without creating anything", async () => {
    const email = uniqueEmail();
    const result = await signUpWithOrganization({
      name: "",
      email,
      password: "short",
      organizationName: "X",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.fieldErrors).sort()).toEqual([
      "name",
      "organizationName",
      "password",
    ]);
    expect(await getDb().select().from(user).where(eq(user.email, email))).toHaveLength(0);
  });
});

describe("resolveAuthContext", () => {
  it("returns the member's role in the active organization", async () => {
    const org = await createTestOrganization();
    const driver = await createTestUser(org.id, "driver");

    await expect(
      resolveAuthContext({ userId: driver.id, activeOrganizationId: org.id }),
    ).resolves.toEqual({ userId: driver.id, organizationId: org.id, role: "driver" });
  });

  it("returns null without an active organization or for a non-member", async () => {
    const org = await createTestOrganization();
    const other = await createTestOrganization("Other");
    const dispatcher = await createTestUser(org.id, "dispatcher");

    expect(await resolveAuthContext({ userId: dispatcher.id, activeOrganizationId: null })).toBe(
      null,
    );
    expect(
      await resolveAuthContext({ userId: dispatcher.id, activeOrganizationId: other.id }),
    ).toBe(null);
  });

  it("reflects role changes immediately", async () => {
    const org = await createTestOrganization();
    const person = await createTestUser(org.id, "dispatcher");
    await getDb()
      .update(member)
      .set({ role: "driver" })
      .where(and(eq(member.userId, person.id), eq(member.organizationId, org.id)));

    const context = await resolveAuthContext({ userId: person.id, activeOrganizationId: org.id });
    expect(context?.role).toBe("driver");
  });
});
