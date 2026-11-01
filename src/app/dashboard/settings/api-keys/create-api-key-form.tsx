"use client";

import { CircleCheckIcon } from "lucide-react";
import { useActionState } from "react";

import { FormAlert } from "@/components/form-alert";
import { TextField } from "@/components/form-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FieldDescription, FieldLegend, FieldSet } from "@/components/ui/field";
import { API_SCOPE_LABELS, API_SCOPES } from "@/domain/api-keys";

import { createApiKeyAction, type CreateApiKeyState } from "./actions";
import { CopyButton } from "./copy-button";

/**
 * Creates a key and shows its secret once. The secret lives only in this component's action
 * state: it is not in the URL, the page's data or the key list, so reloading or navigating away
 * loses it for good (the server keeps only a hash).
 */
export function CreateApiKeyForm() {
  const [state, action, pending] = useActionState<CreateApiKeyState, FormData>(
    createApiKeyAction,
    {},
  );
  const scopeError = state.fieldErrors?.scopes?.[0];

  return (
    <Card className="pb-0">
      <CardHeader>
        <CardTitle>Create an API key</CardTitle>
        <CardDescription>
          A key acts for your whole company. Give it only the scopes the integration needs.
        </CardDescription>
      </CardHeader>
      <form action={action} noValidate>
        <CardContent className="flex flex-col gap-6">
          {state.created && <NewKey name={state.created.name} secret={state.created.secret} />}
          {state.formError && <FormAlert title={state.formError} />}

          <TextField
            name="name"
            label="Name"
            description="Where it is used, e.g. “ERP integration”."
            autoComplete="off"
            maxLength={100}
            required
            errors={state.fieldErrors?.name}
            defaultValue={state.values?.name}
          />

          <FieldSet aria-describedby={scopeError ? "scopes-error" : undefined}>
            <FieldLegend variant="label">Scopes</FieldLegend>
            <div className="flex flex-col gap-3">
              {API_SCOPES.map((scope) => (
                <label key={scope} className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    name="scopes"
                    value={scope}
                    defaultChecked={state.values?.scopes.includes(scope)}
                    aria-invalid={scopeError ? true : undefined}
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                  />
                  <span className="flex flex-col">
                    <span className="font-medium">{API_SCOPE_LABELS[scope].label}</span>
                    <FieldDescription>{API_SCOPE_LABELS[scope].description}</FieldDescription>
                  </span>
                </label>
              ))}
            </div>
            {scopeError && (
              <p id="scopes-error" className="text-sm text-destructive">
                {scopeError}
              </p>
            )}
          </FieldSet>
        </CardContent>
        <CardFooter className="mt-6 justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create key"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function NewKey({ name, secret }: { name: string; secret: string }) {
  return (
    <Alert role="status" data-testid="new-api-key-alert">
      <CircleCheckIcon aria-hidden="true" className="text-emerald-600" />
      <AlertTitle>Key “{name}” created. Copy it now.</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <span>It will not be shown again. If you lose it, revoke it and create another.</span>
        <code
          data-testid="new-api-key"
          className="block rounded-md bg-muted px-3 py-2 font-mono text-xs break-all text-foreground select-all"
        >
          {secret}
        </code>
        <span>
          <CopyButton value={secret} label="Copy key" />
        </span>
      </AlertDescription>
    </Alert>
  );
}
