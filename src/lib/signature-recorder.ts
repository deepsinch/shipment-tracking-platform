import {
  roundCoordinate,
  SIGNATURE_MAX_BYTES,
  SIGNATURE_MAX_POINTS,
  SIGNATURE_MAX_STROKES,
  type Signature,
  type SignaturePoint,
} from "@/domain/signature";

/**
 * The state of a signature being drawn: finished strokes and the one in progress. Pure and
 * immutable (every function returns a new state), so the pad component only forwards pointer
 * positions and the rules (thinning, undo, the size budget) are unit tested.
 *
 * Points are normalised to 0..1 of the pad, rounded for storage, and thinned: a point closer than
 * `MIN_STEP` to the previous one adds bytes without changing the picture.
 */
export type RecorderState = {
  strokes: SignaturePoint[][];
  /** The stroke the pointer is drawing now; null between strokes. */
  drawing: SignaturePoint[] | null;
};

export const EMPTY_RECORDER: RecorderState = { strokes: [], drawing: null };

/** Distance (in pad units) under which a new point is skipped. About 1 px on a 300 px pad. */
const MIN_STEP = 0.003;

/** Leave room below the server's cap for the JSON around the points. */
const BYTE_BUDGET = SIGNATURE_MAX_BYTES - 2048;
/** `[0.123,0.456],` is 14 bytes; the budget assumes the worst case of every point. */
const BYTES_PER_POINT = 14;

function pointCount(state: RecorderState): number {
  return (
    state.strokes.reduce((sum, stroke) => sum + stroke.length, 0) + (state.drawing?.length ?? 0)
  );
}

/** Whether another point still fits the size budget (and the stroke limit for a new stroke). */
export function hasRoom(state: RecorderState, newStroke: boolean): boolean {
  if (newStroke && state.strokes.length >= SIGNATURE_MAX_STROKES) return false;
  const points = pointCount(state);
  return points < SIGNATURE_MAX_POINTS && (points + 1) * BYTES_PER_POINT <= BYTE_BUDGET;
}

export function beginStroke(state: RecorderState, x: number, y: number): RecorderState {
  const finished = endStroke(state);
  if (!hasRoom(finished, true)) return finished;
  return { ...finished, drawing: [[roundCoordinate(x), roundCoordinate(y)]] };
}

export function extendStroke(state: RecorderState, x: number, y: number): RecorderState {
  if (!state.drawing || !hasRoom(state, false)) return state;
  const point: SignaturePoint = [roundCoordinate(x), roundCoordinate(y)];
  const last = state.drawing[state.drawing.length - 1]!;
  if (Math.hypot(point[0] - last[0], point[1] - last[1]) < MIN_STEP) return state;
  return { ...state, drawing: [...state.drawing, point] };
}

export function endStroke(state: RecorderState): RecorderState {
  if (!state.drawing) return state;
  return { strokes: [...state.strokes, state.drawing], drawing: null };
}

/** Removes the last stroke (or abandons the one in progress). */
export function undoStroke(state: RecorderState): RecorderState {
  if (state.drawing) return { ...state, drawing: null };
  return { strokes: state.strokes.slice(0, -1), drawing: null };
}

/** True when nothing more can be added: the pad tells the driver to undo or clear. */
export function isFull(state: RecorderState): boolean {
  return !hasRoom(state, false);
}

export function isEmpty(state: RecorderState): boolean {
  return state.strokes.length === 0 && state.drawing === null;
}

/** The signature to send, or null when nothing was drawn. */
export function toSignature(state: RecorderState, aspect: number): Signature | null {
  const finished = endStroke(state);
  if (finished.strokes.length === 0) return null;
  return { aspect: Math.round(aspect * 100) / 100, strokes: finished.strokes };
}
