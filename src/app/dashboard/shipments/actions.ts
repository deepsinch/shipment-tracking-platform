"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import { shipmentStatusLabel } from "@/domain/shipment-status";
import { dateTimeLocalAsUtc, formValues, type SubmittedValues } from "@/lib/form-data";
import { requireAuthContext } from "@/server/auth/session";
import { changeShipmentStatus } from "@/server/services/change-shipment-status";
import { createShipment } from "@/server/services/create-shipment";
import type { FieldErrors } from "@/server/services/results";

/**
 * Thin wiring between forms and services: the services own authorization and validation. These
 * actions map form fields onto service input and results onto messages for the form.
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

const STATUS_FORM_FIELDS = [
  "toStatus",
  "occurredAt",
  "publicNote",
  "internalNote",
  "locationCity",
] as const;

export type StatusFormState = {
  outcome?: "updated" | "conflict" | "error";
  /** Shown above the form: a confirmation, or what went wrong and what to do. */
  message?: string;
  title?: string;
  /** Keyed by form field name (`locationCity`, not the service's `location.city`). */
  fieldErrors?: FieldErrors;
  /** Echoed into the fields after a failed attempt, so nothing typed is lost. */
  values?: SubmittedValues;
};

export async function changeStatusAction(
  _prev: StatusFormState,
  formData: FormData,
): Promise<StatusFormState> {
  const ctx = await requireAuthContext();
  const shipmentId = String(formData.get("shipmentId") ?? "");
  const values = formValues(formData, STATUS_FORM_FIELDS);

  const result = await changeShipmentStatus(ctx, {
    shipmentId,
    expectedVersion: formData.get("expectedVersion"),
    toStatus: values.toStatus,
    occurredAt: dateTimeLocalAsUtc(values.occurredAt),
    publicNote: values.publicNote,
    internalNote: values.internalNote,
    location: { city: values.locationCity },
  });

  if (result.ok) {
    revalidateShipment(shipmentId);
    return {
      outcome: "updated",
      message: `Status changed to ${shipmentStatusLabel(result.shipment.status)}.`,
    };
  }

  switch (result.reason) {
    case "conflict":
      // Re-render the page with the fresh shipment and timeline; the form picks up the new
      // version, so the user can review what changed and submit again.
      revalidateShipment(shipmentId);
      return {
        outcome: "conflict",
        title: "Someone else updated this shipment",
        message: `It is now ${shipmentStatusLabel(result.current.status)}. The details and history now show the latest changes. Review them, then try again.`,
        values,
      };
    case "invalid_transition":
      return {
        outcome: "error",
        title: "That status change is not possible",
        message: `A shipment that is ${shipmentStatusLabel(result.from)} cannot move to ${shipmentStatusLabel(result.to)}. Choose one of the listed statuses.`,
        values,
      };
    case "forbidden":
      return {
        outcome: "error",
        title: "Your role cannot set this status",
        message: "Ask a dispatcher or admin to make this change.",
        values,
      };
    case "validation": {
      const { "location.city": locationCity, ...fieldErrors } = result.fieldErrors;
      return {
        outcome: "error",
        title: "Please correct the highlighted fields.",
        fieldErrors: locationCity ? { ...fieldErrors, locationCity } : fieldErrors,
        values,
      };
    }
    case "not_found":
      notFound();
  }
}

function revalidateShipment(id: string): void {
  revalidatePath(shipmentPath(id));
  revalidatePath(SHIPMENTS_PATH);
}
