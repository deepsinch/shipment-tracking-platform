"use client";

import { LoaderCircleIcon, SparklesIcon } from "lucide-react";
import { useActionState } from "react";

import { FormAlert } from "@/components/form-alert";
import { FieldShell } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { INTAKE_MAX_BYTES } from "@/domain/intake";

import { draftFromEmailAction, type IntakeState } from "./intake-action";

type Props = {
  state: IntakeState;
  action: (formData: FormData) => void;
  pending: boolean;
};

/**
 * "Paste a request email": the text goes to the assistant, which fills the form below as a draft.
 * Nothing is booked from here. The panel only exists when AI intake is configured.
 */
export function IntakePanel({ state, action, pending }: Props) {
  return (
    <Card data-testid="intake-panel">
      <CardHeader>
        <CardTitle>
          <h2 className="flex items-center gap-2">
            <SparklesIcon className="size-4" aria-hidden="true" />
            Paste a request email
          </h2>
        </CardTitle>
        <CardDescription>
          An AI assistant reads the email and fills in the form below as a draft. You check every
          field, then create the shipment yourself. Nothing is booked automatically.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} noValidate className="flex flex-col gap-4" aria-busy={pending}>
          {state.error && <FormAlert title={state.error.title}>{state.error.message}</FormAlert>}
          <FieldShell
            name="emailText"
            label="Request email"
            description={`Up to ${INTAKE_MAX_BYTES / 1024} KB. The text is sent to Anthropic's API to be read, and is not stored by Waybill.`}
          >
            {(control) => (
              <Textarea
                {...control}
                rows={8}
                placeholder="Paste the email here, including the addresses, weight and any deadline."
                defaultValue={state.emailText}
                className="min-h-40"
              />
            )}
          </FieldShell>
          <div className="flex justify-end">
            <Button type="submit" disabled={pending} variant="secondary">
              {pending ? (
                <>
                  <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
                  Reading the email…
                </>
              ) : (
                "Fill the form from this email"
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** The hook the workspace uses, so the panel and the form share one state. */
export function useIntake() {
  return useActionState<IntakeState, FormData>(draftFromEmailAction, {});
}
