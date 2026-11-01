"use client";

import { useActionState, useId } from "react";

import { changeStatusAction, type StatusFormState } from "@/app/_actions/change-status";
import { ActionMessage } from "@/components/action-message";
import { SelectField, TextAreaField, TextField } from "@/components/form-field";
import {
  TerminalStatusDialog,
  useTerminalStatusConfirmation,
} from "@/components/terminal-status-confirmation";
import { Button } from "@/components/ui/button";
import { shipmentStatusLabel, type ShipmentStatus } from "@/domain/shipment-status";

type Props = {
  shipmentId: string;
  trackingCode: string;
  /** The version this page was rendered from; sent back for the optimistic concurrency check. */
  version: number;
  status: ShipmentStatus;
  /** From `statusOptionsFor(role, status)`; empty for terminal statuses. */
  options: ShipmentStatus[];
};

/**
 * The action state lives here, above the form, so a message survives the form being re-keyed. On a
 * conflict the action revalidates the page: this component then receives the new `version`,
 * `status` and `options`, and the form remounts (key = version) with the user's notes echoed back.
 *
 * Delivered and cancelled cannot be undone, so choosing one asks for confirmation before the form
 * is submitted (see `useTerminalStatusConfirmation`).
 */
export function StatusChangeForm({ shipmentId, trackingCode, version, status, options }: Props) {
  const [state, action, pending] = useActionState<StatusFormState, FormData>(
    changeStatusAction,
    {},
  );
  const formId = useId();
  const confirmation = useTerminalStatusConfirmation();
  const values = state.values;
  const field = (name: string) => ({
    name,
    errors: state.fieldErrors?.[name],
    defaultValue: values?.[name],
  });
  // After a conflict the previously chosen status may no longer be offered.
  const chosenStatus = options.find((option) => option === values?.toStatus) ?? "";

  return (
    <div className="flex flex-col gap-4">
      <ActionMessage state={state} />
      {options.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This shipment is {shipmentStatusLabel(status).toLowerCase()}. Its status can no longer
          change.
        </p>
      ) : (
        <form
          key={version}
          id={formId}
          action={action}
          onSubmit={confirmation.onSubmit}
          noValidate
          // A live refresh that brings a new version remounts this form; wait while it has input.
          data-unsaved-guard
          className="flex flex-col gap-4"
        >
          <input type="hidden" name="shipmentId" value={shipmentId} />
          <input type="hidden" name="expectedVersion" value={version} />
          <SelectField
            {...field("toStatus")}
            defaultValue={chosenStatus}
            label="New status"
            required
            options={[
              { value: "", label: "Choose a status" },
              ...options.map((option) => ({ value: option, label: shipmentStatusLabel(option) })),
            ]}
          />
          <TextField
            {...field("occurredAt")}
            label="When (UTC, optional)"
            type="datetime-local"
            description="Leave empty for now. Backdate if the update was delayed."
          />
          <TextField {...field("locationCity")} label="City (optional)" autoComplete="off" />
          <TextAreaField
            {...field("publicNote")}
            label="Note for the customer (optional)"
            description="Shown on the public tracking page and in the customer's email."
            rows={2}
          />
          <TextAreaField
            {...field("internalNote")}
            label="Internal note (optional)"
            description="Only your company sees this."
            rows={2}
          />
          <Button type="submit" disabled={pending}>
            {pending ? "Updating…" : "Update status"}
          </Button>
          <TerminalStatusDialog
            formId={formId}
            trackingCode={trackingCode}
            status={confirmation.pendingStatus}
            onDismiss={confirmation.dismiss}
          />
        </form>
      )}
    </div>
  );
}
