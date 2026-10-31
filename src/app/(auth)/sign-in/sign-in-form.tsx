"use client";

import Link from "next/link";
import { useActionState } from "react";

import { signInAction, type SignInState } from "../actions";

export function SignInForm() {
  const [state, action, pending] = useActionState<SignInState, FormData>(signInAction, {});

  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        Email
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.values?.email}
          className="border p-2"
        />
      </label>
      <label className="flex flex-col gap-1">
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="border p-2"
        />
      </label>
      {state.formError && <p role="alert">{state.formError}</p>}
      <button type="submit" disabled={pending} className="border p-2">
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <p>
        No account? <Link href="/sign-up">Create one</Link>
      </p>
    </form>
  );
}
