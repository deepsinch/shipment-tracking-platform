"use server";

import { isAPIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getAuth } from "@/server/auth/auth";
import { signUpWithOrganization, type SignUpFieldErrors } from "@/server/auth/sign-up";

/**
 * React resets a form after its action completes, so failed submissions echo back the non-secret
 * values for the inputs' `defaultValue`. Passwords are never echoed.
 */
type SubmittedValues = Record<string, string>;

export type SignUpState = {
  fieldErrors?: SignUpFieldErrors;
  formError?: string;
  values?: SubmittedValues;
};
export type SignInState = { formError?: string; values?: SubmittedValues };

function nonSecretValues(formData: FormData, names: readonly string[]): SubmittedValues {
  return Object.fromEntries(names.map((name) => [name, String(formData.get(name) ?? "")]));
}

export async function signUpAction(_prev: SignUpState, formData: FormData): Promise<SignUpState> {
  const result = await signUpWithOrganization(Object.fromEntries(formData));
  if (!result.ok) {
    return {
      fieldErrors: result.fieldErrors,
      formError: result.formError,
      values: nonSecretValues(formData, ["name", "email", "organizationName"]),
    };
  }

  // Sign in only now, so the session hook finds the new organization and makes it active.
  await getAuth().api.signInEmail({
    body: { email: String(formData.get("email")), password: String(formData.get("password")) },
    headers: await headers(),
  });
  redirect("/dashboard");
}

const signInSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(1),
});

export async function signInAction(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const values = nonSecretValues(formData, ["email"]);
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { formError: "Enter your email and password.", values };

  try {
    await getAuth().api.signInEmail({ body: parsed.data, headers: await headers() });
  } catch (error) {
    if (isAPIError(error)) return { formError: "Invalid email or password.", values };
    throw error;
  }
  redirect("/dashboard");
}

export async function signOutAction(): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/sign-in");
}
