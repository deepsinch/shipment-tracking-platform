"use client";

import { useActionState } from "react";

import { ActionMessage } from "@/components/action-message";
import { SelectField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import type { DriverOption } from "@/server/services/list-drivers";

import { assignDriverAction, type AssignDriverState } from "../actions";

type Props = {
  shipmentId: string;
  /** The version this page was rendered from; sent back for the optimistic concurrency check. */
  version: number;
  assignedDriverId: string | null;
  drivers: DriverOption[];
};

/**
 * Assign, reassign or unassign the driver. Built like the status form: the action state lives
 * above the form, and the form is keyed by `version`, so after a conflict (or any other change)
 * it remounts on the fresh shipment, keeping the driver the user chose.
 */
export function AssignDriverForm({ shipmentId, version, assignedDriverId, drivers }: Props) {
  const [state, action, pending] = useActionState<AssignDriverState, FormData>(
    assignDriverAction,
    {},
  );

  return (
    <div className="flex flex-col gap-4">
      <ActionMessage state={state} />
      <form key={version} action={action} noValidate className="flex flex-col gap-4">
        <input type="hidden" name="shipmentId" value={shipmentId} />
        <input type="hidden" name="expectedVersion" value={version} />
        <SelectField
          name="driverId"
          label="Assigned driver"
          defaultValue={state.values?.driverId ?? assignedDriverId ?? ""}
          errors={state.fieldErrors?.driverId}
          description={drivers.length === 0 ? "Your organization has no drivers yet." : undefined}
          options={[
            { value: "", label: "No driver" },
            ...drivers.map((driver) => ({ value: driver.id, label: driver.name })),
          ]}
        />
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Saving…" : "Save driver"}
        </Button>
      </form>
    </div>
  );
}
