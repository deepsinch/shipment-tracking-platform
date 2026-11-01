"use client";

import { CircleAlertIcon, LoaderCircleIcon } from "lucide-react";
import { useActionState, useId, useLayoutEffect, useState, type FormEvent } from "react";
import { useFormStatus } from "react-dom";

import { changeStatusAction, type StatusFormState } from "@/app/_actions/change-status";
import { deliverShipmentAction, type DeliveryFormState } from "@/app/_actions/deliver-shipment";
import { ActionMessage } from "@/components/action-message";
import { TextAreaField } from "@/components/form-field";
import {
  TerminalStatusDialog,
  useTerminalStatusConfirmation,
} from "@/components/terminal-status-confirmation";
import { Button } from "@/components/ui/button";
import { statusActionLabel } from "@/domain/driver-tasks";
import { shipmentStatusLabel, type ShipmentStatus } from "@/domain/shipment-status";

import { DeliverySheet } from "./delivery-sheet";

type Props = {
  shipmentId: string;
  trackingCode: string;
  /** The version this page was rendered from; sent back for the optimistic concurrency check. */
  version: number;
  status: ShipmentStatus;
  /** From `statusOptionsFor("driver", status)`; empty for terminal statuses. */
  options: ShipmentStatus[];
  /** The addressee, shown in the delivery sheet next to the name field. */
  recipientName: string;
  /** Whether the delivery sheet offers photo capture (storage configured, not demo mode). */
  photosEnabled: boolean;
};

/**
 * The driver's status update: one large button per allowed next status, plus an optional note for
 * the customer. The button that submits the form carries `toStatus`.
 *
 * Same action and conflict handling as the dashboard form: the state lives above the form, a
 * conflict revalidates the page, and the form remounts on the new version (key) with the typed
 * note echoed back and only the buttons that are still allowed.
 *
 * "Mark as delivered" cannot be undone and is the proof moment: instead of the plain confirm step
 * it opens the delivery sheet (printed name, signature, photo). Any other terminal status would
 * still ask for confirmation first (see `useTerminalStatusConfirmation`); drivers are not offered
 * one today.
 */
export function DriverStatusForm({
  shipmentId,
  trackingCode,
  version,
  status,
  options,
  recipientName,
  photosEnabled,
}: Props) {
  const [state, action] = useActionState<StatusFormState, FormData>(changeStatusAction, {});
  const [delivery, deliver] = useActionState<DeliveryFormState, FormData>(
    deliverShipmentAction,
    {},
  );
  const formId = useId();
  const confirmation = useTerminalStatusConfirmation();
  // Open while set; the version and note are those of the moment the driver tapped the button.
  const [sheet, setSheet] = useState<{ version: number; publicNote: string } | null>(null);

  // A sheet left open must not greet the driver when they come back to the page.
  useLayoutEffect(() => () => setSheet(null), []);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(event.currentTarget, submitter);
    if (data.get("toStatus") === "delivered") {
      event.preventDefault();
      setSheet({ version, publicNote: String(data.get("publicNote") ?? "").trim() });
      return;
    }
    confirmation.onSubmit(event);
  }

  return (
    <div className="flex flex-col gap-4">
      <ActionMessage state={delivery.outcome === "updated" ? delivery : state} />
      {options.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This shipment is {shipmentStatusLabel(status).toLowerCase()}. Nothing more to do here.
        </p>
      ) : (
        <form
          key={version}
          id={formId}
          action={action}
          onSubmit={onSubmit}
          noValidate
          // A live refresh that brings a new version remounts this form; wait while it has input.
          data-unsaved-guard
          className="flex flex-col gap-4"
        >
          <input type="hidden" name="shipmentId" value={shipmentId} />
          <input type="hidden" name="expectedVersion" value={version} />
          <TextAreaField
            name="publicNote"
            label="Note for the customer (optional)"
            description="Shown on the public tracking page and in the customer's email."
            rows={2}
            defaultValue={state.values?.publicNote}
            errors={state.fieldErrors?.publicNote}
          />
          <StatusButtons options={options} />
          <TerminalStatusDialog
            formId={formId}
            trackingCode={trackingCode}
            status={confirmation.pendingStatus}
            onDismiss={confirmation.dismiss}
            submitsStatus
          />
        </form>
      )}
      <DeliverySheet
        open={sheet !== null && delivery.outcome !== "updated"}
        onClose={() => setSheet(null)}
        shipmentId={shipmentId}
        trackingCode={trackingCode}
        recipientName={recipientName}
        version={sheet?.version ?? version}
        publicNote={sheet?.publicNote ?? ""}
        photosEnabled={photosEnabled}
        state={delivery}
        action={deliver}
      />
    </div>
  );
}

/**
 * Forward moves first and filled (the first one is the usual next step), a problem report last and
 * visually distinct. While a submission is pending, every button is disabled and the pressed one
 * says so.
 */
function StatusButtons({ options }: { options: ShipmentStatus[] }) {
  const { pending, data } = useFormStatus();
  const submitting = pending ? data?.get("toStatus") : null;
  const forward = options.filter((option) => option !== "exception");
  const problem = options.includes("exception");

  const button = (option: ShipmentStatus, variant: "default" | "outline" | "destructive") => (
    <Button
      key={option}
      type="submit"
      name="toStatus"
      value={option}
      variant={variant}
      disabled={pending}
      aria-describedby={variant === "destructive" ? "problem-hint" : undefined}
      className="h-14 w-full text-base"
    >
      {submitting === option ? (
        <>
          <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
          Updating…
        </>
      ) : (
        <>
          {variant === "destructive" && <CircleAlertIcon aria-hidden="true" />}
          {statusActionLabel(option)}
        </>
      )}
    </Button>
  );

  return (
    <div className="flex flex-col gap-3" aria-busy={pending || undefined}>
      {forward.map((option, index) => button(option, index === 0 ? "default" : "outline"))}
      {problem && (
        <>
          {button("exception", "destructive")}
          <p id="problem-hint" className="text-sm text-muted-foreground">
            Use this for a failed pickup or delivery, damage or a delay. Add a note so the customer
            knows what happened.
          </p>
        </>
      )}
    </div>
  );
}
