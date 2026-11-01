"use client";

import Link from "next/link";
import { useActionState } from "react";

import { FormAlert } from "@/components/form-alert";
import { SelectField, TextField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { FieldLegend, FieldSet } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { SERVICE_LEVEL_LABELS, SERVICE_LEVELS } from "@/domain/service-level";
import type { DriverOption } from "@/server/services/list-drivers";

import { createShipmentAction, type NewShipmentState } from "../actions";

const SERVICE_LEVEL_OPTIONS = SERVICE_LEVELS.map((level) => ({
  value: level,
  label: SERVICE_LEVEL_LABELS[level],
}));

/**
 * Field errors come from the service (`createShipment`), keyed by the same names as the inputs.
 * After a failed submission every value is echoed back, because React resets the form.
 */
export function NewShipmentForm({ drivers }: { drivers: DriverOption[] }) {
  const [state, action, pending] = useActionState<NewShipmentState, FormData>(
    createShipmentAction,
    {},
  );
  const field = (name: string) => ({
    name,
    errors: state.fieldErrors?.[name],
    defaultValue: state.values?.[name],
  });

  const driverOptions = [
    { value: "", label: "Not assigned yet" },
    ...drivers.map((driver) => ({ value: driver.id, label: driver.name })),
  ];

  return (
    <Card className="pb-0">
      <form action={action} noValidate>
        <CardContent className="flex flex-col gap-8">
          {state.formError && <FormAlert title={state.formError} />}

          <FieldSet>
            <FieldLegend className="mb-3">Recipient</FieldLegend>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField {...field("recipientName")} label="Name" autoComplete="off" required />
              <TextField
                {...field("recipientEmail")}
                label="Email (optional)"
                type="email"
                autoComplete="off"
                description="We email delivery updates here. The customer can stop them with a link in the email."
              />
              <TextField
                {...field("reference")}
                label="Reference (optional)"
                autoComplete="off"
                description="Order or PO number, searchable in the list."
              />
            </div>
          </FieldSet>

          <Separator />
          <AddressFieldSet prefix="origin" legend="Pickup" field={field} />
          <Separator />
          <AddressFieldSet prefix="destination" legend="Delivery" field={field} />
          <Separator />

          <FieldSet>
            <FieldLegend className="mb-3">Shipment</FieldLegend>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                {...field("weightKg")}
                label="Weight (kg)"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                required
              />
              <SelectField
                {...field("serviceLevel")}
                defaultValue={state.values?.serviceLevel ?? "standard"}
                label="Service level"
                options={SERVICE_LEVEL_OPTIONS}
              />
              <TextField
                {...field("promisedDeliveryAt")}
                label="Promised delivery (UTC, optional)"
                type="datetime-local"
              />
              <SelectField
                {...field("assignedDriverId")}
                label="Driver (optional)"
                options={driverOptions}
                description={
                  drivers.length === 0 ? "No drivers in your company yet." : "You can assign later."
                }
              />
            </div>
          </FieldSet>
        </CardContent>

        <CardFooter className="mt-8 justify-end gap-2">
          <Button asChild variant="ghost">
            <Link href="/dashboard/shipments">Cancel</Link>
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create shipment"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

type FieldProps = (name: string) => {
  name: string;
  errors?: string[];
  defaultValue?: string;
};

function AddressFieldSet({
  prefix,
  legend,
  field,
}: {
  prefix: "origin" | "destination";
  legend: string;
  field: FieldProps;
}) {
  return (
    <FieldSet>
      <FieldLegend className="mb-3">{legend}</FieldLegend>
      <div className="grid gap-4 sm:grid-cols-6">
        <TextField
          {...field(`${prefix}AddressLine`)}
          label={`${legend} address`}
          autoComplete="off"
          required
          className="sm:col-span-6"
        />
        <TextField
          {...field(`${prefix}PostalCode`)}
          label="Postal code (optional)"
          autoComplete="off"
          className="sm:col-span-2"
        />
        <TextField
          {...field(`${prefix}City`)}
          label={`${legend} city`}
          autoComplete="off"
          required
          className="sm:col-span-2"
        />
        <TextField
          {...field(`${prefix}Country`)}
          label="Country code"
          autoComplete="off"
          placeholder="NL"
          maxLength={2}
          required
          className="sm:col-span-2"
        />
      </div>
    </FieldSet>
  );
}
