"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "@/server/auth/auth";
import { clientIp } from "@/server/auth/client-ip";
import { tooManyAttemptsMessage } from "@/server/auth/rate-limit";
import { signIn } from "@/server/auth/sign-in";
import { signUpFromRequest, type SignUpFieldErrors } from "@/server/auth/sign-up";

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
  const requestHeaders = await headers();
  const values = nonSecretValues(formData, ["name", "email", "organizationName"]);
  const result = await signUpFromRequest(Object.fromEntries(formData), {
    ip: clientIp(requestHeaders),
  });
  if (!result.ok) {
    return "reason" in result
      ? { formError: tooManyAttemptsMessage(result.retryAfterMs), values }
      : { fieldErrors: result.fieldErrors, formError: result.formError, values };
  }

  // Sign in only now, so the session hook finds the new organization and makes it active.
  await getAuth().api.signInEmail({
    body: { email: String(formData.get("email")), password: String(formData.get("password")) },
    headers: requestHeaders,
  });
  redirect("/dashboard");
}

export async function signInAction(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const values = nonSecretValues(formData, ["email"]);
  const requestHeaders = await headers();
  const result = await signIn(Object.fromEntries(formData), {
    ip: clientIp(requestHeaders),
    headers: requestHeaders,
  });
  if (!result.ok) {
    return {
      formError:
        result.reason === "rate_limited"
          ? tooManyAttemptsMessage(result.retryAfterMs)
          : "Invalid email or password.",
      values,
    };
  }
  redirect("/dashboard");
}

export async function signOutAction(): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/sign-in");
}
