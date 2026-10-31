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
