"use client";

import Link from "next/link";
import { useActionState } from "react";

import { FormAlert } from "@/components/form-alert";
import { TextField } from "@/components/form-field";
import { Button } from "@/components/ui/button";

import { signUpAction, type SignUpState } from "../actions";

const FIELDS = [
  { name: "name", label: "Your name", type: "text", autoComplete: "name" },
  { name: "email", label: "Email", type: "email", autoComplete: "email" },
  { name: "password", label: "Password", type: "password", autoComplete: "new-password" },
  { name: "organizationName", label: "Company name", type: "text", autoComplete: "organization" },
] as const;

export function SignUpForm() {
  const [state, action, pending] = useActionState<SignUpState, FormData>(signUpAction, {});
  const hasErrors = Boolean(state.formError || state.fieldErrors);

  return (
    <form action={action} className="flex flex-col gap-4">
      {hasErrors && (
        <FormAlert title={state.formError ?? "Please correct the highlighted fields."} />
      )}
      {FIELDS.map((field) => (
        <TextField
          key={field.name}
          name={field.name}
          label={field.label}
          type={field.type}
          autoComplete={field.autoComplete}
          required
          description={field.type === "password" ? "At least 8 characters." : undefined}
          // Passwords are never echoed back after a failed submission.
          defaultValue={field.type === "password" ? undefined : state.values?.[field.name]}
          errors={state.fieldErrors?.[field.name]}
        />
      ))}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-foreground underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </form>
  );
}
