"use client";

import type { DriverOption } from "@/server/services/list-drivers";

import { IntakePanel, useIntake } from "./intake-panel";
import { NewShipmentForm } from "./new-shipment-form";

/**
 * The new-shipment page's interactive part: the optional "paste an email" panel above the form.
 * A new draft remounts the form (keyed by the draft's id) with its values as defaults, so the
 * dispatcher edits real inputs, not a preview.
 */
export function NewShipmentWorkspace({
  drivers,
  intakeEnabled,
}: {
  drivers: DriverOption[];
  intakeEnabled: boolean;
}) {
  const [intake, action, pending] = useIntake();
  return (
    <>
      {intakeEnabled && <IntakePanel state={intake} action={action} pending={pending} />}
      <NewShipmentForm key={intake.draft?.id ?? "blank"} drivers={drivers} draft={intake.draft} />
    </>
  );
}
