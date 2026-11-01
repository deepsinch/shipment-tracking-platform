/**
 * Signature strokes without any schema library: the part of proof of delivery that browser code
 * (the signature pad) imports. `./delivery-proof` re-exports everything here and adds the Zod
 * schemas, which must stay out of client bundles (Zod probes for `eval` at load, which the
 * Content-Security-Policy reports as a violation on every page that bundles it).
 */

/**
 * Stored signatures stay under this many bytes of JSON. Vector strokes are tiny (a real signature
 * is 2 to 6 KB); the cap exists so one request cannot park megabytes in a row, and the database
 * CHECK repeats it.
 */
export const SIGNATURE_MAX_BYTES = 32 * 1024;

/** Safety nets for the shape, well below what the byte cap allows. */
export const SIGNATURE_MAX_STROKES = 100;
export const SIGNATURE_MAX_POINTS = 2500;

/** Decimal places kept per coordinate: 0.001 of the pad's width is far below a pen's wobble. */
export const SIGNATURE_PRECISION = 3;

/** A point on the pad, each axis normalised to 0..1 (x by the pad's width, y by its height). */
export type SignaturePoint = readonly [x: number, y: number];

/**
 * A drawn signature: strokes (lists of points) and the pad's width-to-height ratio, which is all
 * that is needed to draw it again at any size without distortion.
 */
export type Signature = {
  aspect: number;
  strokes: SignaturePoint[][];
};

/** The viewBox width every signature SVG is drawn in; height follows from the aspect ratio. */
export const SIGNATURE_VIEWBOX_WIDTH = 1000;

/**
 * SVG path data for each stroke, in the viewBox `0 0 SIGNATURE_VIEWBOX_WIDTH <height>`. A single
 * point (a tap, the dot of an "i") becomes a zero-length segment, which a round line cap draws as a
 * dot. Built as strings of numbers only, so React renders them as attributes and nothing is ever
 * parsed as markup.
 */
export function signaturePaths(signature: Signature): { height: number; paths: string[] } {
  const width = SIGNATURE_VIEWBOX_WIDTH;
  const height = round(width / signature.aspect);
  const paths = signature.strokes.map((stroke) => {
    const points = stroke.length === 1 ? [stroke[0]!, stroke[0]!] : stroke;
    return points
      .map(([x, y], index) => `${index === 0 ? "M" : "L"}${round(x * width)} ${round(y * height)}`)
      .join(" ");
  });
  return { height, paths };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The text alternative of a signature, for the pad and the saved proof. */
export function signatureDescription(signature: Signature | null): string {
  if (!signature) return "No signature was drawn.";
  const strokes = signature.strokes.length;
  return `A hand-drawn signature of ${strokes} ${strokes === 1 ? "stroke" : "strokes"}.`;
}

/** Rounds a coordinate for storage. */
export function roundCoordinate(value: number): number {
  const factor = 10 ** SIGNATURE_PRECISION;
  return Math.round(Math.min(1, Math.max(0, value)) * factor) / factor;
}
