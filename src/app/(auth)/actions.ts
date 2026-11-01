"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { DEMO_PASSWORD, DEMO_RESET_LABEL, DEMO_USERS } from "@/domain/demo";
import { homePathFor } from "@/domain/role-home";
import { getAuth } from "@/server/auth/auth";
import { clientIp } from "@/server/auth/client-ip";
import { tooManyAttemptsMessage } from "@/server/auth/rate-limit";
import { signIn } from "@/server/auth/sign-in";
import { signUpFromRequest, type SignUpFieldErrors } from "@/server/auth/sign-up";
import { env } from "@/server/env";

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
  // Sign-up always creates an admin of the new organization.
  redirect(homePathFor("admin"));
}

type Credentials = { email: string; password: string };

/**
 * Signs in through the one sign-in path (`signIn`: validation, rate limits, Better Auth) and
 * sends the user to their role's home. Shared by the sign-in form and the demo's one-click
 * buttons, so the latter get no shortcut around the limits.
 */
async function signInAndRedirect(
  credentials: Credentials,
  invalidMessage: string,
): Promise<SignInState> {
  const values = { email: credentials.email };
  const requestHeaders = await headers();
  const result = await signIn(credentials, {
    ip: clientIp(requestHeaders),
    headers: requestHeaders,
  });
  if (!result.ok) {
    return {
      formError:
        result.reason === "rate_limited"
          ? tooManyAttemptsMessage(result.retryAfterMs)
          : invalidMessage,
      values,
    };
  }
  // Without an organization there is no home; the dashboard guard handles that case as before.
  redirect(result.context ? homePathFor(result.context.role) : "/dashboard");
}

export async function signInAction(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const submitted = Object.fromEntries(formData);
  return signInAndRedirect(
    { email: String(submitted.email ?? ""), password: String(submitted.password ?? "") },
    "Invalid email or password.",
  );
}

const demoAccountSchema = z.literal(DEMO_USERS.map((account) => account.role));

/**
 * The demo's one-click sign-in: the browser names a demo role, the server looks up that account's
 * email and the published demo password. Only on a demo deployment; anywhere else it signs nobody
 * in. It goes through `signIn` like a typed password does, rate limits included.
 */
export async function demoSignInAction(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  if (!env.demo.enabled) return { formError: "Demo sign-in is not available here." };
  const role = demoAccountSchema.safeParse(formData.get("account"));
  if (!role.success) return { formError: "Choose one of the demo accounts." };
  const account = DEMO_USERS.find((candidate) => candidate.role === role.data)!;
  return signInAndRedirect(
    { email: account.email, password: DEMO_PASSWORD },
    "The demo account could not be signed in. The demo may be resetting (it does so nightly " +
      `around ${DEMO_RESET_LABEL}): try again in a minute.`,
  );
}

export async function signOutAction(): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/sign-in");
}
