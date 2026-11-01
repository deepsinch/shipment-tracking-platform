"use client";

import { useLayoutEffect, useState, type FormEvent } from "react";

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
import { isShipmentStatus, isTerminalStatus, type ShipmentStatus } from "@/domain/shipment-status";

/**
 * A confirm step before a status that cannot be undone (delivered, cancelled), shared by the
 * dashboard's status form and the driver app. In the driver app a delivery does not use it: the
 * driver's "Mark as delivered" opens the delivery sheet (printed name, signature, photo), which is
 * the confirmation. Staff marking a delivery from the dashboard still confirm here, and record no
 * proof (see `requiresDeliveryProof`).
 *
 * How it works: the form's `onSubmit` checks the status being submitted (from the pressed button
 * or the select). For a terminal status it cancels the submission and opens an alert dialog
 * instead; its confirm button submits the same form again (`form` attribute, since the dialog is
 * portalled outside it) and is let through. Cancelling the submit event also stops React's form
 * action. The dialog is Radix's alert dialog: focus moves into it (onto the safe choice), is
 * trapped there, Escape closes it, and it is announced with its title and description.
 *
 * This guards against a slip of the thumb, not a trust boundary, so the server does not ask for a
 * confirmation flag. Without JavaScript the form submits directly.
 */
export function useTerminalStatusConfirmation() {
  const [status, setStatus] = useState<ShipmentStatus | null>(null);

  // A dialog left open must not greet the user when they come back to the page (Next keeps
  // hidden routes' state), see node_modules/next/dist/docs/01-app/02-guides/preserving-ui-state.md.
  useLayoutEffect(() => () => setStatus(null), []);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (submitter?.hasAttribute(CONFIRMED_ATTRIBUTE)) {
      setStatus(null);
      return;
    }
    const chosen = new FormData(event.currentTarget, submitter).get("toStatus");
    if (isShipmentStatus(chosen) && isTerminalStatus(chosen)) {
      event.preventDefault();
      setStatus(chosen);
    }
  }

  return { pendingStatus: status, onSubmit, dismiss: () => setStatus(null) };
}

const CONFIRMED_ATTRIBUTE = "data-confirmed";

type Copy = { title: string; description: string; confirm: string; dismiss: string };

function copyFor(status: ShipmentStatus, trackingCode: string): Copy {
  switch (status) {
    case "delivered":
      return {
        title: `Mark ${trackingCode} as delivered?`,
        description:
          "The customer will see the shipment as delivered. This cannot be undone, so only confirm once it is in the recipient's hands.",
        confirm: "Confirm delivery",
        dismiss: "Not yet",
      };
    case "cancelled":
      return {
        title: `Cancel ${trackingCode}?`,
        description:
          "The shipment stops here and the customer will see it as cancelled. This cannot be undone.",
        confirm: "Cancel shipment",
        dismiss: "Keep shipment",
      };
    default:
      return {
        title: "Confirm this status change?",
        description: "This cannot be undone.",
        confirm: "Confirm",
        dismiss: "Go back",
      };
  }
}

type DialogProps = {
  /** The `id` of the form the confirm button submits. */
  formId: string;
  trackingCode: string;
  /** The status awaiting confirmation; the dialog is open while it is set. */
  status: ShipmentStatus | null;
  onDismiss: () => void;
  /**
   * Whether the confirm button carries `toStatus` itself. Needed when the status comes from the
   * pressed button (driver app); not when the form has a select (dashboard).
   */
  submitsStatus?: boolean;
};

export function TerminalStatusDialog({
  formId,
  trackingCode,
  status,
  onDismiss,
  submitsStatus = false,
}: DialogProps) {
  // Keep the last copy while the dialog animates out.
  const [shown, setShown] = useState<ShipmentStatus | null>(status);
  if (status !== null && status !== shown) setShown(status);
  const copy = shown ? copyFor(shown, trackingCode) : null;

  return (
    <AlertDialog open={status !== null} onOpenChange={(open) => !open && onDismiss()}>
      {copy && shown && (
        <AlertDialogContent className="data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg">{copy.title}</AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              {copy.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="lg" className="h-12 text-base sm:h-10 sm:text-sm">
              {copy.dismiss}
            </AlertDialogCancel>
            <Button
              type="submit"
              form={formId}
              size="lg"
              variant={shown === "cancelled" ? "destructive" : "default"}
              className="h-12 text-base sm:h-10 sm:text-sm"
              {...{ [CONFIRMED_ATTRIBUTE]: "" }}
              {...(submitsStatus ? { name: "toStatus", value: shown } : {})}
            >
              {copy.confirm}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  );
}
