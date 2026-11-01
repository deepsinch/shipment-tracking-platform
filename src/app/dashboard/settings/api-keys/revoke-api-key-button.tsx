"use client";

import { useActionState, useState } from "react";

import { ActionMessage, type ActionOutcome } from "@/components/action-message";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

import { revokeApiKeyAction } from "./actions";

/**
 * Revoking cannot be undone and breaks the integration using the key at once, so it asks first.
 * The confirm button submits the form (it lives in a portal, hence the `form` attribute).
 */
export function RevokeApiKeyButton({ keyId, name }: { keyId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<ActionOutcome, FormData>(revokeApiKeyAction, {});
  const formId = `revoke-${keyId}`;

  return (
    <>
      <form id={formId} action={action} onSubmit={() => setOpen(false)}>
        <input type="hidden" name="keyId" value={keyId} />
      </form>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Revoke<span className="sr-only"> key {name}</span>
      </Button>
      {state.outcome === "error" && <ActionMessage state={state} />}

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke “{name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Requests using this key stop working immediately. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep key</AlertDialogCancel>
            <Button type="submit" form={formId} variant="destructive">
              Revoke key
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
