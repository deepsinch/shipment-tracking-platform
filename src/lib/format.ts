/**
 * Dates are shown in UTC, labelled as such, so the server-rendered text is the same for every
 * viewer and matches what the database stores. Per-organization time zones are a later refinement.
 */
const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});
const date = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" });

export function formatDateTime(value: Date): string {
  return `${dateTime.format(value)} UTC`;
}

export function formatDate(value: Date): string {
  return date.format(value);
}

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

/** "NL" -> "Netherlands". Falls back to the code itself if the runtime does not know it. */
export function formatCountry(code: string): string {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** "Rotterdam, Netherlands". */
export function formatPlace(city: string, countryCode: string): string {
  return `${city}, ${formatCountry(countryCode)}`;
}

const weight = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });

export function formatWeight(kg: number): string {
  return `${weight.format(kg)} kg`;
}
