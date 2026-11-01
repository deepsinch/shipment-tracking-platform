"use client";

import { CircleCheckIcon } from "lucide-react";
import { useActionState } from "react";

import { CopyButton } from "@/components/copy-button";
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
import { WEBHOOK_EVENT_LABELS, WEBHOOK_EVENT_TYPES } from "@/domain/webhooks";

import { createWebhookEndpointAction, type CreateWebhookState } from "./actions";

/**
 * Creates an endpoint and shows its signing secret once. The secret lives only in this
 * component's action state, like a new API key's: reloading or navigating away loses it (a lost
 * secret is replaced with "Rotate secret").
 */
export function CreateWebhookForm() {
  const [state, action, pending] = useActionState<CreateWebhookState, FormData>(
    createWebhookEndpointAction,
    {},
  );
  const eventsError = state.fieldErrors?.eventTypes?.[0];

  return (
    <Card className="pb-0">
      <CardHeader>
        <CardTitle>Add a webhook</CardTitle>
        <CardDescription>
          Waybill sends a signed JSON request to your URL whenever one of the chosen events happens.
        </CardDescription>
      </CardHeader>
      <form action={action} noValidate>
        <CardContent className="flex flex-col gap-6">
          {state.created && <NewSecret url={state.created.url} secret={state.created.secret} />}
          {state.formError && <FormAlert title={state.formError} />}

          <TextField
            name="url"
            label="Endpoint URL"
            description="Must start with https:// and be reachable from the internet."
            type="url"
            inputMode="url"
            autoComplete="off"
            maxLength={2000}
            required
            errors={state.fieldErrors?.url}
            defaultValue={state.values?.url}
          />

          <FieldSet aria-describedby={eventsError ? "events-error" : undefined}>
            <FieldLegend variant="label">Events</FieldLegend>
            <div className="flex flex-col gap-3">
              {WEBHOOK_EVENT_TYPES.map((type) => (
                <label key={type} className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    name="eventTypes"
                    value={type}
                    defaultChecked={state.values?.eventTypes.includes(type)}
                    aria-invalid={eventsError ? true : undefined}
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                  />
                  <span className="flex flex-col">
                    <span className="font-medium">{WEBHOOK_EVENT_LABELS[type].label}</span>
                    <FieldDescription>{WEBHOOK_EVENT_LABELS[type].description}</FieldDescription>
                  </span>
                </label>
              ))}
            </div>
            {eventsError && (
              <p id="events-error" className="text-sm text-destructive">
                {eventsError}
              </p>
            )}
          </FieldSet>
        </CardContent>
        <CardFooter className="mt-6 justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? "Adding…" : "Add webhook"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function NewSecret({ url, secret }: { url: string; secret: string }) {
  return (
    <Alert role="status" data-testid="new-webhook-alert">
      <CircleCheckIcon aria-hidden="true" className="text-emerald-600" />
      <AlertTitle>Webhook for {url} added. Copy the signing secret now.</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <span>It will not be shown again. If you lose it, rotate the secret.</span>
        <code
          data-testid="new-webhook-secret"
          className="block rounded-md bg-muted px-3 py-2 font-mono text-xs break-all text-foreground select-all"
        >
          {secret}
        </code>
        <span>
          <CopyButton value={secret} label="Copy secret" />
        </span>
      </AlertDescription>
    </Alert>
  );
}
