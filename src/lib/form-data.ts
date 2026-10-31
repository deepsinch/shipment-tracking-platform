/**
 * Helpers for Server Actions that hand form submissions to services. Services validate; these
 * only reshape what the browser sends.
 */

/** Submitted values as strings, for echoing back into `defaultValue` after a failed submission. */
export type SubmittedValues = Record<string, string>;

/** The named fields of a submission as strings (missing fields become ""). */
export function formValues(formData: FormData, names: readonly string[]): SubmittedValues {
  return Object.fromEntries(
    names.map((name) => {
      const value = formData.get(name);
      return [name, typeof value === "string" ? value : ""];
    }),
  );
}

const DATETIME_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/;

/**
 * `<input type="datetime-local">` submits a wall-clock time without a zone ("2026-11-02T14:30").
 * The app shows every time in UTC and labels the inputs accordingly, so read it as UTC instead of
 * the server's local zone. Anything else is passed through for the service to validate.
 */
export function dateTimeLocalAsUtc(value: string | undefined): string | undefined {
  return value && DATETIME_LOCAL.test(value) ? `${value}Z` : value;
}
