import { isAPIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/server/db/client";
import { user } from "@/server/db/schema";

import { getAuth } from "./auth";

export const signUpSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(100),
  email: z.email("Enter a valid email address").trim().toLowerCase(),
  password: z.string().min(8, "Use at least 8 characters").max(128),
  organizationName: z.string().trim().min(2, "Enter your company name").max(100),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignUpFieldErrors = Partial<Record<keyof SignUpInput, string[]>>;

export type SignUpResult =
  | { ok: true; userId: string; organizationId: string }
  | { ok: false; fieldErrors: SignUpFieldErrors; formError?: string };

/**
 * Creates a user and a new organization in which they are the admin. Does not sign in: the caller
 * signs in afterwards so the new session starts with the organization active.
 *
 * Better Auth owns the user and organization tables, so the two steps cannot share one database
 * transaction. If creating the organization fails, the user is removed again so no org-less user
 * is left behind.
 */
export async function signUpWithOrganization(input: unknown): Promise<SignUpResult> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const { name, email, password, organizationName } = parsed.data;
  const auth = getAuth();

  const duplicateEmail: SignUpResult = {
    ok: false,
    fieldErrors: { email: ["An account with this email already exists"] },
  };

  let userId: string;
  try {
    const result = await auth.api.signUpEmail({ body: { name, email, password } });
    userId = result.user.id;
  } catch (error) {
    if (isAPIError(error) && String(error.body?.code ?? "").startsWith("USER_ALREADY_EXISTS")) {
      return duplicateEmail;
    }
    throw error;
  }

  // With autoSignIn disabled, Better Auth does not reject an existing email: to prevent account
  // enumeration it returns a synthetic success with a user id that was never stored. Confirm the
  // user really exists before creating an organization for it.
  const [stored] = await getDb().select({ id: user.id }).from(user).where(eq(user.id, userId));
  if (!stored) return duplicateEmail;

  try {
    const organization = await auth.api.createOrganization({
      body: { name: organizationName, slug: organizationSlug(organizationName), userId },
    });
    return { ok: true, userId, organizationId: organization.id };
  } catch (error) {
    await getDb().delete(user).where(eq(user.id, userId));
    throw error;
  }
}

/** URL-safe slug with a random suffix, so two companies with the same name never collide. */
function organizationSlug(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = crypto.randomUUID().slice(0, 8);
  return base ? `${base}-${suffix}` : suffix;
}
