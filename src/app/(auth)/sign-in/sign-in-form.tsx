"use client";

import Link from "next/link";
import { useActionState } from "react";

import { FormAlert } from "@/components/form-alert";
import { TextField } from "@/components/form-field";
import { Button } from "@/components/ui/button";

import { signInAction, type SignInState } from "../actions";

export function SignInForm() {
  const [state, action, pending] = useActionState<SignInState, FormData>(signInAction, {});

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.formError && <FormAlert title={state.formError} />}
      <TextField
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        required
        defaultValue={state.values?.email}
      />
      <TextField
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        No account?{" "}
        <Link href="/sign-up" className="font-medium text-foreground underline underline-offset-4">
          Create one
        </Link>
      </p>
    </form>
  );
}
