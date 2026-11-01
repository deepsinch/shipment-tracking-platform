"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";

import type { ActionOutcome } from "@/components/action-message";
import { shipmentStatusLabel } from "@/domain/shipment-status";
import { dateTimeLocalAsUtc, formValues, type SubmittedValues } from "@/lib/form-data";
import { requireAuthContext } from "@/server/auth/session";
import { changeShipmentStatus } from "@/server/services/change-shipment-status";
import type { FieldErrors } from "@/server/services/results";
import { deliverWebhooksAfterResponse } from "@/server/webhooks/schedule";

/**
 * The status change action, shared by the dashboard's detail page and the driver app. The service
 * decides what the caller may do; this maps form fields onto its input and every result onto a
 * message. Forms send only the fields they have (the driver app has no time, city or internal
 * note), and missing fields are treated as blank.
 */

const STATUS_FORM_FIELDS = [
  "toStatus",
  "occurredAt",
  "publicNote",
  "internalNote",
  "locationCity",
] as const;

/** `outcome`, `title` and `message` are shown above the form by `ActionMessage`. */
export type StatusFormState = ActionOutcome & {
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
    deliverWebhooksAfterResponse();
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

/** Both surfaces show the shipment; revalidating a path the caller cannot open is harmless. */
function revalidateShipment(id: string): void {
  revalidatePath(`/dashboard/shipments/${id}`);
  revalidatePath("/dashboard/shipments");
  revalidatePath(`/driver/shipments/${id}`);
  revalidatePath("/driver");
}
