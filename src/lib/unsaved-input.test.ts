import { describe, expect, it } from "vitest";

import { isFieldEdited } from "./unsaved-input";

const options = (defaults: boolean[], selected: number) =>
  defaults.map((defaultSelected, index) => ({ defaultSelected, selected: index === selected }));

describe("isFieldEdited", () => {
  it("compares text inputs and textareas with their rendered value", () => {
    expect(isFieldEdited({ type: "text", value: "", defaultValue: "" })).toBe(false);
    expect(isFieldEdited({ type: "textarea", value: "Gate code 4411", defaultValue: "" })).toBe(
      true,
    );
    // An echoed value after a failed submission is the rendered value, not an edit.
    expect(isFieldEdited({ type: "textarea", value: "echoed", defaultValue: "echoed" })).toBe(
      false,
    );
    expect(isFieldEdited({ type: "datetime-local", value: "2026-10-31T10:00" })).toBe(true);
  });

  it("ignores hidden fields and buttons", () => {
    expect(isFieldEdited({ type: "hidden", value: "7", defaultValue: "6" })).toBe(false);
    expect(isFieldEdited({ type: "submit", value: "picked_up", defaultValue: "" })).toBe(false);
  });

  it("compares checkboxes with their default", () => {
    expect(isFieldEdited({ type: "checkbox", checked: true, defaultChecked: false })).toBe(true);
    expect(isFieldEdited({ type: "checkbox", checked: true, defaultChecked: true })).toBe(false);
  });

  it("compares a select with its default option", () => {
    const select = (defaults: boolean[], selectedIndex: number) => ({
      type: "select-one",
      selectedIndex,
      options: options(defaults, selectedIndex),
    });
    expect(isFieldEdited(select([false, true, false], 1))).toBe(false);
    expect(isFieldEdited(select([false, true, false], 2))).toBe(true);
    // No explicit default: the first option is what was rendered.
    expect(isFieldEdited(select([false, false], 0))).toBe(false);
    expect(isFieldEdited(select([false, false], 1))).toBe(true);
  });
});
