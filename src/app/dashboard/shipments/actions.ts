"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import type { ActionOutcome } from "@/components/action-message";
import { shipmentStatusLabel } from "@/domain/shipment-status";
import { dateTimeLocalAsUtc, formValues, type SubmittedValues } from "@/lib/form-data";
import { requireAuthContext } from "@/server/auth/session";
import { assignDriver } from "@/server/services/assign-driver";
import { createShipment } from "@/server/services/create-shipment";
import type { FieldErrors } from "@/server/services/results";

/**
 * Thin wiring between forms and services: the services own authorization and validation. These
 * actions map form fields onto service input and results onto messages for the form. The status
 * change action is shared with the driver app, see `app/_actions/change-status.ts`.
 */

const SHIPMENTS_PATH = "/dashboard/shipments";
const shipmentPath = (id: string) => `${SHIPMENTS_PATH}/${id}`;

/** Every field of the new shipment form; all are echoed back on failure (none are secret). */
const NEW_SHIPMENT_FIELDS = [
  "reference",
  "recipientName",
  "recipientEmail",
  "originAddressLine",
  "originCity",
  "originPostalCode",
  "originCountry",
  "destinationAddressLine",
  "destinationCity",
  "destinationPostalCode",
  "destinationCountry",
  "weightKg",
  "serviceLevel",
  "promisedDeliveryAt",
  "assignedDriverId",
] as const;

export type NewShipmentState = {
  formError?: string;
  fieldErrors?: FieldErrors;
  values?: SubmittedValues;
};

export async function createShipmentAction(
  _prev: NewShipmentState,
  formData: FormData,
): Promise<NewShipmentState> {
  const ctx = await requireAuthContext();
  const values = formValues(formData, NEW_SHIPMENT_FIELDS);

  const result = await createShipment(ctx, {
    ...values,
    promisedDeliveryAt: dateTimeLocalAsUtc(values.promisedDeliveryAt),
  });
  if (!result.ok) {
    return result.reason === "forbidden"
      ? { formError: "Only admins and dispatchers can create shipments.", values }
      : {
          formError: "Please correct the highlighted fields.",
          fieldErrors: result.fieldErrors,
          values,
        };
  }

  revalidatePath(SHIPMENTS_PATH);
  redirect(shipmentPath(result.shipment.id));
}

export type AssignDriverState = ActionOutcome & {
  fieldErrors?: FieldErrors;
  /** The chosen driver, echoed after a failed attempt so a retry is one click. */
  values?: SubmittedValues;
};

export async function assignDriverAction(
  _prev: AssignDriverState,
  formData: FormData,
): Promise<AssignDriverState> {
  const ctx = await requireAuthContext();
  const shipmentId = String(formData.get("shipmentId") ?? "");
  const values = formValues(formData, ["driverId"]);

  const result = await assignDriver(ctx, {
    shipmentId,
    expectedVersion: formData.get("expectedVersion"),
    driverId: values.driverId,
  });

  if (result.ok) {
    revalidateShipment(shipmentId);
    return {
      outcome: "updated",
      message: result.shipment.assignedDriverId ? "Driver assigned." : "Driver unassigned.",
    };
  }

  switch (result.reason) {
    case "conflict":
      // As for status changes: show the fresh shipment, rebuild the form on the new version.
      revalidateShipment(shipmentId);
      return {
        outcome: "conflict",
        title: "Someone else updated this shipment",
        message:
          "The details and history now show the latest changes. Review them, then try again.",
        values,
      };
    case "closed":
      revalidateShipment(shipmentId);
      return {
        outcome: "error",
        title: "The driver can no longer change",
        message: `This shipment is ${shipmentStatusLabel(result.status).toLowerCase()}.`,
      };
    case "forbidden":
      return {
        outcome: "error",
        title: "Your role cannot assign drivers",
        message: "Ask a dispatcher or admin to make this change.",
        values,
      };
    case "validation":
      return {
        outcome: "error",
        title: "Please correct the highlighted field.",
        fieldErrors: result.fieldErrors,
        values,
      };
    case "not_found":
      notFound();
  }
}

function revalidateShipment(id: string): void {
  revalidatePath(shipmentPath(id));
  revalidatePath(SHIPMENTS_PATH);
}
