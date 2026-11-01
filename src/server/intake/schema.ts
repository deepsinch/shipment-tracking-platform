import { z } from "zod";

import { INTAKE_FIELDS, type IntakeField } from "@/domain/intake";

/**
 * The shape the model is asked to answer in (sent as a JSON schema, so the API constrains the
 * answer): every extractable field, as text, or null when the email does not say. Deliberately
 * plain: no formats or ranges here. The model's job is to read; the booking rules that decide
 * whether a value is acceptable are `createShipmentSchema`'s, applied afterwards (`buildDraft`).
 */
const requestShape = Object.fromEntries(
  INTAKE_FIELDS.map((field) => [field, z.string().nullable()]),
) as Record<IntakeField, z.ZodNullable<z.ZodString>>;

export const intakeRequestSchema = z.object(requestShape);

/** JSON Schema for `output_config.format`: all keys required, nothing else allowed. */
export function intakeJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(intakeRequestSchema, { io: "output" }) as Record<string, unknown>;
  delete schema.$schema;
  return { ...schema, additionalProperties: false };
}

/**
 * How an answer is read back: leniently, because the model's output is data to inspect, not a
 * contract. Unknown keys are dropped (a model that was talked into adding `status` or
 * `assignedDriverId` changes nothing), a number becomes text, anything else becomes "not found".
 */
const lenientValue = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .catch(null)
  .transform((value) => (value === null || value === undefined ? null : String(value)));

export const intakeAnswerSchema = z.object(
  Object.fromEntries(INTAKE_FIELDS.map((field) => [field, lenientValue])) as Record<
    IntakeField,
    typeof lenientValue
  >,
);
