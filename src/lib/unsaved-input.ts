/**
 * Detects input the user typed but has not submitted, so a live refresh can wait instead of
 * wiping it. Forms opt in with this attribute: those keyed by the shipment's `version` remount
 * when a refresh brings a new version, which resets their fields. Plain forms (the list's search
 * box) keep their DOM values across a refresh and need no guard.
 */
export const UNSAVED_GUARD_ATTRIBUTE = "data-unsaved-guard";

/** The parts of an input, select or textarea this check reads. */
export type FieldLike = {
  type?: string;
  value?: string;
  defaultValue?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  selectedIndex?: number;
  options?: ArrayLike<{ selected: boolean; defaultSelected: boolean }>;
};

const IGNORED_TYPES = new Set(["hidden", "submit", "button", "reset", "image", "fieldset"]);

/** True when the field's current value differs from the one it was rendered with. */
export function isFieldEdited(field: FieldLike): boolean {
  const type = field.type ?? "";
  if (IGNORED_TYPES.has(type)) return false;
  if (type === "checkbox" || type === "radio") return field.checked !== field.defaultChecked;
  if (type === "select-one" && field.options) {
    // Without an explicit default, a single select shows its first option.
    let defaultIndex = 0;
    for (let i = 0; i < field.options.length; i++) {
      if (field.options[i]!.defaultSelected) defaultIndex = i;
    }
    return field.options.length > 0 && field.selectedIndex !== defaultIndex;
  }
  if (type === "select-multiple" && field.options) {
    return Array.from(field.options).some((option) => option.selected !== option.defaultSelected);
  }
  return (field.value ?? "") !== (field.defaultValue ?? "");
}

/** True when any guarded form under `root` has an edited field. */
export function hasUnsavedInput(root: ParentNode): boolean {
  const forms = root.querySelectorAll<HTMLFormElement>(`form[${UNSAVED_GUARD_ATTRIBUTE}]`);
  return Array.from(forms).some((form) =>
    Array.from(form.elements).some((element) => isFieldEdited(element as FieldLike)),
  );
}
