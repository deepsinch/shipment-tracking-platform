import type * as React from "react";

import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

/** Props every form control needs so its label, hint and error are announced together. */
type ControlProps = {
  id: string;
  name: string;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
};

type FieldShellProps = {
  name: string;
  label: string;
  /** Messages from the server, e.g. a service's `fieldErrors[name]`. Only the first is shown. */
  errors?: string[];
  description?: string;
  className?: string;
  children: (control: ControlProps) => React.ReactNode;
};

/**
 * Label, control, hint and error, wired with `aria-describedby` and `aria-invalid`. Errors are
 * plain text (not `role="alert"`): the form shows one summary alert, so a screen reader does not
 * announce every field at once.
 */
export function FieldShell({
  name,
  label,
  errors,
  description,
  className,
  children,
}: FieldShellProps) {
  const id = `field-${name}`;
  const error = errors?.[0];
  const describedBy = [description && `${id}-hint`, error && `${id}-error`]
    .filter(Boolean)
    .join(" ");

  return (
    <Field data-invalid={error ? true : undefined} className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children({
        id,
        name,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy || undefined,
      })}
      {description && <FieldDescription id={`${id}-hint`}>{description}</FieldDescription>}
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </Field>
  );
}

type Shared = Omit<FieldShellProps, "children">;

export function TextField({
  name,
  label,
  errors,
  description,
  className,
  ...inputProps
}: Shared & Omit<React.ComponentProps<typeof Input>, "name" | "id">) {
  return (
    <FieldShell {...{ name, label, errors, description, className }}>
      {(control) => <Input {...inputProps} {...control} />}
    </FieldShell>
  );
}

export function TextAreaField({
  name,
  label,
  errors,
  description,
  className,
  ...textareaProps
}: Shared & Omit<React.ComponentProps<typeof Textarea>, "name" | "id">) {
  return (
    <FieldShell {...{ name, label, errors, description, className }}>
      {(control) => <Textarea {...textareaProps} {...control} />}
    </FieldShell>
  );
}

export function SelectField({
  name,
  label,
  errors,
  description,
  className,
  options,
  ...selectProps
}: Shared &
  Omit<React.ComponentProps<"select">, "name" | "id" | "size"> & {
    options: readonly { value: string; label: string }[];
  }) {
  return (
    <FieldShell {...{ name, label, errors, description, className }}>
      {(control) => (
        <NativeSelect className="w-full" {...selectProps} {...control}>
          {options.map((option) => (
            <NativeSelectOption key={option.value} value={option.value}>
              {option.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )}
    </FieldShell>
  );
}
