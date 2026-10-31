"use client";

import { CircleAlertIcon, LoaderCircleIcon } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { changeStatusAction, type StatusFormState } from "@/app/_actions/change-status";
import { ActionMessage } from "@/components/action-message";
import { TextAreaField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { statusActionLabel } from "@/domain/driver-tasks";
import { shipmentStatusLabel, type ShipmentStatus } from "@/domain/shipment-status";

type Props = {
  shipmentId: string;
  /** The version this page was rendered from; sent back for the optimistic concurrency check. */
  version: number;
  status: ShipmentStatus;
  /** From `statusOptionsFor("driver", status)`; empty for terminal statuses. */
  options: ShipmentStatus[];
};

/**
 * The driver's status update: one large button per allowed next status, plus an optional note for
 * the customer. The button that submits the form carries `toStatus`.
 *
 * Same action and conflict handling as the dashboard form: the state lives above the form, a
 * conflict revalidates the page, and the form remounts on the new version (key) with the typed
 * note echoed back and only the buttons that are still allowed.
 */
export function DriverStatusForm({ shipmentId, version, status, options }: Props) {
  const [state, action] = useActionState<StatusFormState, FormData>(changeStatusAction, {});

  return (
    <div className="flex flex-col gap-4">
      <ActionMessage state={state} />
      {options.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This shipment is {shipmentStatusLabel(status).toLowerCase()}. Nothing more to do here.
        </p>
      ) : (
        <form key={version} action={action} noValidate className="flex flex-col gap-4">
          <input type="hidden" name="shipmentId" value={shipmentId} />
          <input type="hidden" name="expectedVersion" value={version} />
          <TextAreaField
            name="publicNote"
            label="Note for the customer (optional)"
            description="Shown on the public tracking page."
            rows={2}
            defaultValue={state.values?.publicNote}
            errors={state.fieldErrors?.publicNote}
          />
          <StatusButtons options={options} />
        </form>
      )}
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
