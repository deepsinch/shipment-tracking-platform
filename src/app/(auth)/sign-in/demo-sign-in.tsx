"use client";

import { useActionState } from "react";

import { FormAlert } from "@/components/form-alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEMO_USERS } from "@/domain/demo";
import { ROLE_LABELS } from "@/domain/roles";

import { demoSignInAction, type SignInState } from "../actions";

const WHAT_TO_TRY = {
  admin: "Everything, including drivers",
  dispatcher: "Book and move shipments",
  driver: "The phone view of a driver",
} as const;

/**
 * One-click sign-in for the three demo accounts (demo mode only; the page decides). Each button
 * submits the account's role to `demoSignInAction`, which signs in through the normal path with
 * its rate limits. No credentials are in the page.
 */
export function DemoSignIn() {
  const [state, action, pending] = useActionState<SignInState, FormData>(demoSignInAction, {});

  return (
    <Card data-testid="demo-sign-in" className="mt-4">
      <CardHeader>
        <CardTitle>
          <h2>Try the demo</h2>
        </CardTitle>
        <CardDescription>One click, no password. Pick who you want to be.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-2">
          {state.formError && <FormAlert title={state.formError} />}
          {DEMO_USERS.map((account) => (
            <Button
              key={account.role}
              type="submit"
              name="account"
              value={account.role}
              variant="outline"
              disabled={pending}
              className="h-auto justify-between gap-3 px-3 py-2 text-left"
            >
              <span className="flex flex-col">
                <span>
                  Sign in as {ROLE_LABELS[account.role].toLowerCase()}{" "}
                  <span className="font-normal text-muted-foreground">
                    ({account.name.split(" ")[0]})
                  </span>
                </span>
                <span className="text-xs font-normal text-muted-foreground">
                  {WHAT_TO_TRY[account.role]}
                </span>
              </span>
            </Button>
          ))}
        </form>
      </CardContent>
    </Card>
  );
}
