import { describe, expect, it } from "vitest";

import { fitWithin, PHOTO_MAX_EDGE } from "./photo-resize";

describe("fitWithin", () => {
  it("scales the longer edge down to the limit and keeps the ratio", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: PHOTO_MAX_EDGE, height: 1200 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1200, height: PHOTO_MAX_EDGE });
  });

  it("never scales up", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("never returns an empty canvas", () => {
    expect(fitWithin(100000, 1)).toEqual({ width: PHOTO_MAX_EDGE, height: 1 });
  });
});
