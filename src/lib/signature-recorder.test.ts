import { describe, expect, it } from "vitest";

import {
  SIGNATURE_MAX_BYTES,
  SIGNATURE_MAX_POINTS,
  SIGNATURE_MAX_STROKES,
  signatureSchema,
} from "@/domain/delivery-proof";

import {
  beginStroke,
  EMPTY_RECORDER,
  endStroke,
  extendStroke,
  isEmpty,
  isFull,
  toSignature,
  undoStroke,
  type RecorderState,
} from "./signature-recorder";

function draw(state: RecorderState, points: [number, number][]): RecorderState {
  const [first, ...rest] = points;
  let next = beginStroke(state, first![0], first![1]);
  for (const [x, y] of rest) next = extendStroke(next, x, y);
  return endStroke(next);
}

describe("signature recorder", () => {
  it("records strokes in order, rounded to three decimals", () => {
    const state = draw(EMPTY_RECORDER, [
      [0.1234567, 0.5],
      [0.3, 0.45678],
    ]);
    expect(state.strokes).toEqual([
      [
        [0.123, 0.5],
        [0.3, 0.457],
      ],
    ]);
  });

  it("keeps points on the pad", () => {
    const state = draw(EMPTY_RECORDER, [
      [-0.2, 1.4],
      [0.5, 0.5],
    ]);
    expect(state.strokes[0]![0]).toEqual([0, 1]);
  });

  it("skips points that barely moved", () => {
    const state = draw(EMPTY_RECORDER, [
      [0.5, 0.5],
      [0.501, 0.5],
      [0.502, 0.5],
      [0.6, 0.5],
    ]);
    expect(state.strokes[0]).toEqual([
      [0.5, 0.5],
      [0.6, 0.5],
    ]);
  });

  it("keeps a single tap as a one-point stroke", () => {
    expect(draw(EMPTY_RECORDER, [[0.5, 0.5]]).strokes).toEqual([[[0.5, 0.5]]]);
  });

  it("undo removes the last stroke, or abandons the one being drawn", () => {
    const two = draw(
      draw(EMPTY_RECORDER, [
        [0.1, 0.1],
        [0.2, 0.2],
      ]),
      [
        [0.5, 0.5],
        [0.6, 0.6],
      ],
    );
    expect(undoStroke(two).strokes).toHaveLength(1);
    expect(undoStroke(undoStroke(two))).toEqual(EMPTY_RECORDER);
    expect(isEmpty(undoStroke(undoStroke(two)))).toBe(true);

    const mid = extendStroke(beginStroke(two, 0.8, 0.8), 0.9, 0.9);
    expect(undoStroke(mid)).toEqual({ strokes: two.strokes, drawing: null });
  });

  it("produces nothing for an empty pad and a schema-valid signature otherwise", () => {
    expect(toSignature(EMPTY_RECORDER, 2.2)).toBeNull();
    const signature = toSignature(
      draw(EMPTY_RECORDER, [
        [0.1, 0.1],
        [0.4, 0.3],
      ]),
      2.2037,
    );
    expect(signature?.aspect).toBe(2.2);
    expect(signatureSchema.safeParse(signature).success).toBe(true);
  });

  it("includes a stroke still in progress when the signature is read", () => {
    const mid = extendStroke(beginStroke(EMPTY_RECORDER, 0.1, 0.1), 0.4, 0.4);
    expect(toSignature(mid, 2)?.strokes).toHaveLength(1);
  });

  it("stops taking points at the budget, and what it holds still passes the server's schema", () => {
    let state = beginStroke(EMPTY_RECORDER, 0, 0);
    // A long zig-zag with a step well above the thinning distance.
    for (let i = 1; i < SIGNATURE_MAX_POINTS * 2; i += 1) {
      state = extendStroke(state, (i % 2) * 0.999, (i % 7) / 7);
    }
    expect(isFull(state)).toBe(true);
    const count = state.drawing!.length;
    expect(count).toBeLessThan(SIGNATURE_MAX_POINTS);
    expect(extendStroke(state, 0.5, 0.5).drawing!.length).toBe(count);

    const signature = toSignature(state, 2)!;
    expect(JSON.stringify(signature).length).toBeLessThanOrEqual(SIGNATURE_MAX_BYTES);
    expect(signatureSchema.safeParse(signature).success).toBe(true);
  });

  it("stops starting strokes at the stroke limit", () => {
    let state = EMPTY_RECORDER;
    for (let i = 0; i < SIGNATURE_MAX_STROKES + 5; i += 1) state = draw(state, [[0.5, 0.5]]);
    expect(state.strokes).toHaveLength(SIGNATURE_MAX_STROKES);
  });
});
