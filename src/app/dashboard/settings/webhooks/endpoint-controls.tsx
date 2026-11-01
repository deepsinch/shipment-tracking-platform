"use client";

import { CircleCheckIcon } from "lucide-react";
import { useActionState, useState } from "react";

import { ActionMessage, type ActionOutcome } from "@/components/action-message";
import { CopyButton } from "@/components/copy-button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import {
  rotateWebhookSecretAction,
  setWebhookEnabledAction,
  type RotateSecretState,
} from "./actions";

/**
 * Enable or disable an endpoint, and rotate its secret. Disabling is cheap to undo, so it does
 * not ask; rotating breaks the receiver until it has the new secret, so it does.
 */
export function EndpointControls({
  endpointId,
  url,
  enabled,
}: {
  endpointId: string;
  url: string;
  enabled: boolean;
}) {
  const [toggleState, toggle, toggling] = useActionState<ActionOutcome, FormData>(
    setWebhookEnabledAction,
    {},
  );
  const [rotateState, rotate] = useActionState<RotateSecretState, FormData>(
    rotateWebhookSecretAction,
    {},
  );
  const [open, setOpen] = useState(false);
  const formId = `rotate-${endpointId}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <form action={toggle}>
          <input type="hidden" name="endpointId" value={endpointId} />
          <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
          <Button type="submit" variant="outline" size="sm" disabled={toggling}>
            {enabled ? "Disable" : "Enable"}
            <span className="sr-only"> webhook {url}</span>
          </Button>
        </form>
        <form id={formId} action={rotate} onSubmit={() => setOpen(false)}>
          <input type="hidden" name="endpointId" value={endpointId} />
        </form>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          Rotate secret<span className="sr-only"> for {url}</span>
        </Button>
      </div>

      {toggleState.outcome === "error" && <ActionMessage state={toggleState} />}
      {rotateState.outcome === "error" && <ActionMessage state={rotateState} />}
      {rotateState.secret && (
        <Alert role="status" data-testid="rotated-webhook-alert">
          <CircleCheckIcon aria-hidden="true" className="text-emerald-600" />
          <AlertTitle>New signing secret. Copy it now.</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <span>It will not be shown again. The old secret no longer signs deliveries.</span>
            <code
              data-testid="rotated-webhook-secret"
              className="block rounded-md bg-muted px-3 py-2 font-mono text-xs break-all text-foreground select-all"
            >
              {rotateState.secret}
            </code>
            <span>
              <CopyButton value={rotateState.secret} label="Copy secret" />
            </span>
          </AlertDescription>
        </Alert>
      )}

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Rotate the secret?</AlertDialogTitle>
            <AlertDialogDescription>
              Deliveries are signed with the new secret from now on. Your receiver rejects them
              until you give it the new secret, so update it right after.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current secret</AlertDialogCancel>
            <Button type="submit" form={formId} variant="destructive">
              Rotate secret
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
