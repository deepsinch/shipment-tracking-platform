"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { dateTimeLocalAsUtc, formValues, type SubmittedValues } from "@/lib/form-data";
import { requireAuthContext } from "@/server/auth/session";
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
