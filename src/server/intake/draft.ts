import "server-only";

import {
  appearsIn,
  countryToIso2,
  GROUNDED_FIELDS,
  INTAKE_FIELDS,
  isoToDateTimeLocalUtc,
  normalizeServiceLevel,
  weightToKg,
  type IntakeDraft,
  type IntakeField,
} from "@/domain/intake";
import { createShipmentSchema } from "@/server/services/create-shipment";

import { intakeAnswerSchema } from "./schema";

/**
 * Turns the model's raw answer into a draft the form can be prefilled with. The answer is
 * untrusted, so every field goes through the same steps:
 *
 * 1. Only the known keys are read (anything else the model added is dropped).
 * 2. A deterministic clean-up: country names to ISO codes, units to kilograms, dates to UTC.
 * 3. Fields that cannot be paraphrased (email, reference, postal codes) must literally appear in
 *    the email, or they were invented and are dropped.
 * 4. The value must pass that field's rule from `createShipmentSchema`, the schema booking uses.
 *    A value that fails is dropped, not repaired.
 *
 * What is missing stays blank: a blank field is a prompt for the dispatcher, a guess is a trap.
 */
export function buildDraft(raw: unknown, emailText: string): IntakeDraft {
  const answer = intakeAnswerSchema.safeParse(raw);
  const extracted = answer.success ? answer.data : null;

  const values = {} as Record<IntakeField, string>;
  const status = {} as IntakeDraft["status"];
  for (const field of INTAKE_FIELDS) {
    const result = checkField(field, extracted?.[field] ?? null, emailText);
    values[field] = result.value;
    status[field] = result.status;
  }
  return { values, status };
}

function checkField(
  field: IntakeField,
  rawValue: string | null,
  emailText: string,
): { value: string; status: IntakeDraft["status"][IntakeField] } {
  const text = rawValue?.replace(/\s+/g, " ").trim() ?? "";
  if (text === "") return { value: "", status: "not_found" };

  const value = normalize(field, text);
  if (value === "") return { value: "", status: "invalid" };
  if (GROUNDED_FIELDS.includes(field) && !appearsIn(value, emailText)) {
    return { value: "", status: "not_found" };
  }

  // The form submits `datetime-local` text, which the action reads as UTC.
  const candidate = field === "promisedDeliveryAt" ? `${value}:00Z` : value;
  const rule = createShipmentSchema.shape[field];
  return rule.safeParse(candidate).success
    ? { value, status: "found" }
    : { value: "", status: "invalid" };
}

function normalize(field: IntakeField, text: string): string {
  switch (field) {
    case "originCountry":
    case "destinationCountry":
      return countryToIso2(text);
    case "weightKg":
      return weightToKg(text);
    case "promisedDeliveryAt":
      return isoToDateTimeLocalUtc(text);
    case "serviceLevel":
      return normalizeServiceLevel(text);
    case "recipientEmail":
      return text.toLowerCase();
    default:
      return text;
  }
}
