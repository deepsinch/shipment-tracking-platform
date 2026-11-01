"use server";

import { notFound } from "next/navigation";

import type { ActionOutcome } from "@/components/action-message";
import { formValues, type SubmittedValues } from "@/lib/form-data";
import { requireAuthContext } from "@/server/auth/session";
import { deliverShipment } from "@/server/services/deliver-shipment";
import type { FieldErrors } from "@/server/services/results";
import { deliverOutboxAfterResponse } from "@/server/webhooks/schedule";

import { revalidateShipment } from "./revalidate-shipment";

/**
 * The driver app's delivery: the recipient's printed name, an optional signature (strokes as JSON)
 * and an optional photo (already shrunk in the browser), handed to `deliverShipment`. Every result
 * becomes a message in the delivery sheet; what was typed is echoed back.
 */

const DELIVERY_FORM_FIELDS = ["recipientName", "publicNote"] as const;

export type DeliveryFormState = ActionOutcome & {
  fieldErrors?: FieldErrors;
  values?: SubmittedValues;
};

export async function deliverShipmentAction(
  _prev: DeliveryFormState,
  formData: FormData,
): Promise<DeliveryFormState> {
  const ctx = await requireAuthContext();
  const shipmentId = String(formData.get("shipmentId") ?? "");
  const values = formValues(formData, DELIVERY_FORM_FIELDS);
  const photo = formData.get("photo");

  const result = await deliverShipment(ctx, {
    shipmentId,
    expectedVersion: formData.get("expectedVersion"),
    recipientName: values.recipientName,
    signature: formData.get("signature"),
    publicNote: values.publicNote,
    // A form with no file chosen still sends an empty one.
    photo: photo instanceof File && photo.size > 0 ? photo : null,
  });

  if (result.ok) {
    deliverOutboxAfterResponse();
    revalidateShipment(shipmentId);
    return { outcome: "updated", message: "Status changed to Delivered." };
  }

  switch (result.reason) {
    case "conflict":
      revalidateShipment(shipmentId);
      return {
        outcome: "conflict",
        title: "Someone else updated this shipment",
        message:
          "The page behind this sheet now shows the latest status. Close the sheet, review it, then deliver again.",
        values,
      };
    case "invalid_transition":
      return {
        outcome: "error",
        title: "This shipment cannot be delivered now",
        message:
          "It has to be out for delivery first. Close the sheet and check the shipment's status.",
        values,
      };
    case "forbidden":
      return {
        outcome: "error",
        title: "Your role cannot do this",
        message: "Ask a dispatcher or admin to make this change.",
        values,
      };
    case "photo_failed":
      return {
        outcome: "error",
        title: "The photo could not be saved",
        message: "Nothing was delivered. Try again, or remove the photo and deliver without it.",
        values,
      };
    case "validation":
      return {
        outcome: "error",
        title: "Please correct the highlighted fields.",
        fieldErrors: result.fieldErrors,
        values,
      };
    case "not_found":
      notFound();
  }
}
