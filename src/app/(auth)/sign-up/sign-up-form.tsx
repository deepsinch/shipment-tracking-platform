"use client";

import Link from "next/link";
import { useActionState } from "react";

import { signUpAction, type SignUpState } from "../actions";

const FIELDS = [
  { name: "name", label: "Your name", type: "text", autoComplete: "name" },
  { name: "email", label: "Email", type: "email", autoComplete: "email" },
  { name: "password", label: "Password", type: "password", autoComplete: "new-password" },
  { name: "organizationName", label: "Company name", type: "text", autoComplete: "organization" },
] as const;

export function SignUpForm() {
  const [state, action, pending] = useActionState<SignUpState, FormData>(signUpAction, {});

  return (
    <form action={action} className="flex flex-col gap-3">
      {FIELDS.map((field) => {
        const errors = state.fieldErrors?.[field.name];
        const errorId = `${field.name}-error`;
        return (
          <label key={field.name} className="flex flex-col gap-1">
            {field.label}
            <input
              name={field.name}
              type={field.type}
              autoComplete={field.autoComplete}
              required
              defaultValue={field.type === "password" ? undefined : state.values?.[field.name]}
              aria-invalid={errors ? true : undefined}
              aria-describedby={errors ? errorId : undefined}
              className="border p-2"
            />
            {errors && <span id={errorId}>{errors[0]}</span>}
          </label>
        );
      })}
      {state.formError && <p role="alert">{state.formError}</p>}
      <button type="submit" disabled={pending} className="border p-2">
        {pending ? "Creating account…" : "Create account"}
      </button>
      <p>
        Already have an account? <Link href="/sign-in">Sign in</Link>
      </p>
    </form>
  );
}
