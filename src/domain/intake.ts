/**
 * AI intake, the pure part (no I/O, no schema library, so the browser can import it too): which
 * fields an email can fill, the limits, and the deterministic clean-up applied to whatever the
 * model says (country names to ISO codes, units to kilograms, dates to UTC). The model is asked
 * for these formats, but it is never trusted to deliver them: see docs/architecture.md, "AI
 * intake".
 */

/** The form fields an email can fill. Coordinates and the driver are never extracted. */
export const INTAKE_FIELDS = [
  "recipientName",
  "recipientEmail",
  "reference",
  "originAddressLine",
  "originPostalCode",
  "originCity",
  "originCountry",
  "destinationAddressLine",
  "destinationPostalCode",
  "destinationCity",
  "destinationCountry",
  "weightKg",
  "serviceLevel",
  "promisedDeliveryAt",
] as const;

export type IntakeField = (typeof INTAKE_FIELDS)[number];

export const INTAKE_FIELD_LABELS: Record<IntakeField, string> = {
  recipientName: "Recipient name",
  recipientEmail: "Recipient email",
  reference: "Reference",
  originAddressLine: "Pickup address",
  originPostalCode: "Pickup postal code",
  originCity: "Pickup city",
  originCountry: "Pickup country",
  destinationAddressLine: "Delivery address",
  destinationPostalCode: "Delivery postal code",
  destinationCity: "Delivery city",
  destinationCountry: "Delivery country",
  weightKg: "Weight",
  serviceLevel: "Service level",
  promisedDeliveryAt: "Promised delivery",
};

/**
 * `found`: filled from the email and valid. `not_found`: the email does not say (or the model's
 * answer is not in the email). `invalid`: the model gave something the booking rules reject, so it
 * was dropped.
 */
export type IntakeFieldStatus = "found" | "not_found" | "invalid";

/** What the new-shipment form is prefilled with, keyed by form field; blank when not usable. */
export type IntakeDraft = {
  values: Record<IntakeField, string>;
  status: Record<IntakeField, IntakeFieldStatus>;
};

/** An email is pasted text, not a mailbox: 20 KB is a long thread. Bytes, not characters. */
export const INTAKE_MAX_BYTES = 20 * 1024;

/** Requests per organization per day, and for the whole public demo per day. */
export const INTAKE_DAILY_LIMIT_PER_ORGANIZATION = 50;
export const INTAKE_DAILY_LIMIT_DEMO = 200;

/** Whether AI intake is on: a key (or the test-only fake) is configured. */
export function intakeAvailable(config: { apiKey: string | undefined; useFake: boolean }): boolean {
  return Boolean(config.apiKey) || config.useFake;
}

// ---------------------------------------------------------------------------------------------
// Countries
// ---------------------------------------------------------------------------------------------

const COUNTRY_NAMES: Record<string, readonly string[]> = {
  NL: [
    "netherlands",
    "the netherlands",
    "holland",
    "nederland",
    "pays-bas",
    "niederlande",
    "paises bajos",
    "paesi bassi",
    "nl",
  ],
  BE: ["belgium", "belgie", "belgique", "belgien", "belgica", "belgio", "be"],
  DE: ["germany", "deutschland", "allemagne", "alemania", "germania", "duitsland", "de"],
  FR: ["france", "frankreich", "francia", "frankrijk", "fr"],
  LU: ["luxembourg", "luxemburg", "lu"],
  ES: ["spain", "espana", "spanien", "spanje", "espagne", "spagna", "es"],
  IT: ["italy", "italia", "italien", "italie", "it"],
  AT: ["austria", "osterreich", "autriche", "oostenrijk", "at"],
  CH: ["switzerland", "schweiz", "suisse", "svizzera", "zwitserland", "ch"],
  PL: ["poland", "polska", "polen", "pologne", "pl"],
  PT: ["portugal", "pt"],
  DK: ["denmark", "danmark", "danemark", "dänemark", "denemarken", "dk"],
  SE: ["sweden", "sverige", "schweden", "suede", "zweden", "se"],
  IE: ["ireland", "eire", "irland", "irlande", "ierland", "ie"],
  GB: [
    "united kingdom",
    "uk",
    "great britain",
    "england",
    "vereinigtes konigreich",
    "royaume-uni",
    "verenigd koninkrijk",
    "gb",
  ],
  CZ: ["czech republic", "czechia", "tschechien", "tchequie", "tsjechie", "cz"],
  NO: ["norway", "norge", "norwegen", "norvege", "noorwegen", "no"],
  FI: ["finland", "suomi", "finnland", "finlande", "fi"],
  HU: ["hungary", "magyarorszag", "ungarn", "hongrie", "hongarije", "hu"],
  GR: ["greece", "griechenland", "grece", "griekenland", "gr"],
};

/** Lower case, no accents, no leading or trailing punctuation: "Belgié" and "belgie." match. */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/^[\s.,;:]+|[\s.,;:]+$/g, "")
    .replace(/\s+/g, " ");
}

const COUNTRY_LOOKUP = new Map<string, string>(
  Object.entries(COUNTRY_NAMES).flatMap(([code, names]) =>
    names.map((name) => [fold(name), code] as const),
  ),
);

/** An ISO 3166-1 alpha-2 code for a code or a country name in English, German, French, Dutch... or "" when unsure. */
export function countryToIso2(value: string | null | undefined): string {
  if (!value) return "";
  const known = COUNTRY_LOOKUP.get(fold(value));
  if (known) return known;
  // A code for a country outside the name table is fine if it is a real region code.
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && isRegionCode(code) ? code : "";
}

function isRegionCode(code: string): boolean {
  try {
    // Unknown codes come back unchanged (or as "Unknown Region").
    const name = new Intl.DisplayNames(["en"], { type: "region" }).of(code);
    return Boolean(name) && name !== code && name !== "Unknown Region";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Weight
// ---------------------------------------------------------------------------------------------

const WEIGHT_UNITS: Record<string, number> = {
  kg: 1,
  kgs: 1,
  kilo: 1,
  kilos: 1,
  kilogram: 1,
  kilograms: 1,
  kilogramm: 1,
  kilogramme: 1,
  kilogrammes: 1,
  g: 0.001,
  gr: 0.001,
  gram: 0.001,
  grams: 0.001,
  gramm: 0.001,
  grammes: 0.001,
  t: 1000,
  tonne: 1000,
  tonnes: 1000,
  ton: 1000,
  tons: 1000,
  tonnen: 1000,
  tonnellen: 1000,
  lb: 0.45359237,
  lbs: 0.45359237,
  pound: 0.45359237,
  pounds: 0.45359237,
};

/**
 * "12,5 kg", "2 t", "450 lbs", "1.250,50 kg" to kilograms with two decimals, as the form's text;
 * "" when there is no number or the unit is not one we know (a guess would be an invented weight).
 */
export function weightToKg(value: string | null | undefined): string {
  if (!value) return "";
  const match = /^\s*(\d[\d.,\s]*)\s*([a-zA-Z]*)\.?\s*$/.exec(value);
  if (!match) return "";
  const unit = match[2]!.toLowerCase();
  const factor = unit === "" ? 1 : WEIGHT_UNITS[unit];
  if (factor === undefined) return "";

  let digits = match[1]!.replace(/\s/g, "");
  const lastComma = digits.lastIndexOf(",");
  const lastDot = digits.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // The later separator is the decimal one: 1.250,50 or 1,250.50.
    const decimal = lastComma > lastDot ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    digits = digits.replaceAll(thousands, "").replace(decimal, ".");
  } else if (lastComma >= 0) {
    digits = digits.replace(",", ".");
  }
  const number = Number(digits);
  if (!Number.isFinite(number) || number <= 0) return "";
  const kg = Math.round(number * factor * 100) / 100;
  return kg > 0 ? String(kg) : "";
}

// ---------------------------------------------------------------------------------------------
// Dates and service levels
// ---------------------------------------------------------------------------------------------

/**
 * An ISO 8601 timestamp as the form's UTC `datetime-local` text ("2026-11-12T16:00"). An offset is
 * applied ("+01:00" becomes UTC); a time without one is read as UTC, as the whole app does. Anything
 * that is not ISO 8601 is refused: "next Friday" is a guess the model must resolve, not us.
 */
export function isoToDateTimeLocalUtc(value: string | null | undefined): string {
  if (!value) return "";
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(text))
    return "";
  const hasTime = text.includes("T");
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(text.slice(10));
  const date = new Date(hasTime ? (hasZone ? text : `${text}Z`) : `${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 16);
}

export function normalizeServiceLevel(value: string | null | undefined): string {
  if (!value) return "";
  const folded = fold(value).replace(/[\s-]+/g, "_");
  return folded === "standard" || folded === "express" || folded === "same_day" ? folded : "";
}

// ---------------------------------------------------------------------------------------------
// Grounding
// ---------------------------------------------------------------------------------------------

const squash = (text: string) => fold(text).replace(/[\s\-_.]/g, "");

/**
 * Whether a value the model returned really appears in the email (ignoring case, spaces and
 * dashes). Used for the fields that cannot be paraphrased or translated (an email address, a
 * reference, a postal code): if the model's answer is not in the text, it was made up, and a
 * made-up address or reference is worse than a blank one.
 */
export function appearsIn(value: string, emailText: string): boolean {
  const needle = squash(value);
  return needle.length > 0 && squash(emailText).includes(needle);
}

/** Fields whose value must literally appear in the email. */
export const GROUNDED_FIELDS: readonly IntakeField[] = [
  "recipientEmail",
  "reference",
  "originPostalCode",
  "destinationPostalCode",
];
