import { describe, expect, it } from "vitest";

import { dateTimeLocalAsUtc, formValues } from "./form-data";

describe("formValues", () => {
  it("returns the named fields as strings, with missing ones blank", () => {
    const formData = new FormData();
    formData.set("name", "Ada");
    formData.set("file", new Blob(["x"]));

    expect(formValues(formData, ["name", "file", "missing"])).toEqual({
      name: "Ada",
      file: "",
      missing: "",
    });
  });
});

describe("dateTimeLocalAsUtc", () => {
  it("reads a datetime-local value as UTC", () => {
    expect(dateTimeLocalAsUtc("2026-11-02T14:30")).toBe("2026-11-02T14:30Z");
    expect(new Date(dateTimeLocalAsUtc("2026-11-02T14:30:15")!).toISOString()).toBe(
      "2026-11-02T14:30:15.000Z",
    );
  });

  it("passes blank and malformed values through for the service to judge", () => {
    expect(dateTimeLocalAsUtc("")).toBe("");
    expect(dateTimeLocalAsUtc(undefined)).toBeUndefined();
    expect(dateTimeLocalAsUtc("tomorrow")).toBe("tomorrow");
  });
});
