import { z } from "zod";

/**
 * Proof of delivery, pure rules (no I/O): what a signature is, how big it may be, how it becomes
 * SVG paths, and how an uploaded photo is recognised and cleaned. See docs/architecture.md,
 * "Proof of delivery".
 */

/** The printed name is the proof every delivery has; the longest name we accept. */
export const RECIPIENT_NAME_MAX_LENGTH = 120;

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

const coordinate = z.number().min(0).max(1);

const UNREADABLE_SIGNATURE = "The signature could not be read. Clear it and sign again.";

export const signatureSchema = z
  .object(
    {
      aspect: z.number({ error: UNREADABLE_SIGNATURE }).min(0.5).max(8),
      strokes: z
        .array(
          z
            .array(z.tuple([coordinate, coordinate]))
            .min(1)
            .max(SIGNATURE_MAX_POINTS),
        )
        .min(1, "Draw a signature or leave the pad empty")
        .max(SIGNATURE_MAX_STROKES),
    },
    { error: UNREADABLE_SIGNATURE },
  )
  .strict()
  .refine(
    (signature) =>
      signature.strokes.reduce((sum, stroke) => sum + stroke.length, 0) <= SIGNATURE_MAX_POINTS,
    `The signature has too many points (at most ${SIGNATURE_MAX_POINTS})`,
  )
  .refine(
    (signature) => byteLength(JSON.stringify(signature)) <= SIGNATURE_MAX_BYTES,
    "The signature is too large. Clear it and sign again.",
  );

/**
 * Strokes as the browser sends them: a JSON string in a form field. Blank means "no signature".
 * Text that is not JSON (or is enormous) comes back as a string, which the schema reports as an
 * unreadable signature.
 */
export function parseSignatureJson(raw: unknown): unknown {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") return raw;
  if (raw.trim() === "") return undefined;
  // Refuse to parse an enormous string at all: the cap is on what we store, but the work is on
  // what we read.
  if (byteLength(raw) > SIGNATURE_MAX_BYTES * 2) return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Whether the stored JSON is a valid signature (a row written by an older release could differ). */
export function asSignature(value: unknown): Signature | null {
  const parsed = signatureSchema.safeParse(value);
  return parsed.success ? (parsed.data as Signature) : null;
}

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

// ---------------------------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------------------------

/**
 * The largest photo we store. Below Vercel's 4.5 MB request body limit (the photo travels in the
 * Server Action's request, with the rest of the form), so the platform never rejects what we
 * would have accepted. The driver app shrinks photos before upload; this is the server's own limit.
 */
export const PHOTO_MAX_BYTES = 4 * 1024 * 1024;

/** Image types accepted from the driver app. WebP and HEIC are re-encoded to JPEG on the phone. */
export const PHOTO_CONTENT_TYPES = ["image/jpeg", "image/png"] as const;
export type PhotoContentType = (typeof PHOTO_CONTENT_TYPES)[number];

export const PHOTO_EXTENSIONS: Record<PhotoContentType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
};

/** The image type of `bytes` by its magic number, or null. The client's claimed type is ignored. */
export function sniffPhotoType(bytes: Uint8Array): PhotoContentType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= png.length && png.every((value, index) => bytes[index] === value)) {
    return "image/png";
  }
  return null;
}

/**
 * Removes metadata that can carry the driver's location or device details, keeping what is needed
 * to show the picture. Returns null when the file is not a well-formed image of that type (a
 * truncated or tampered file is refused, not stored).
 *
 * - JPEG: the marker segments before the scan are walked; APP1 (EXIF and XMP, which hold GPS),
 *   APP13 (IPTC/Photoshop) and COM (comments) are dropped. APP0 (JFIF), APP2 (ICC colour profile),
 *   APP14 (Adobe colour transform) and everything that decodes the picture stay.
 * - PNG: chunks are walked; `eXIf`, `tEXt`, `zTXt` and `iTXt` are dropped. Kept chunks keep their
 *   own CRCs.
 */
export function stripPhotoMetadata(bytes: Uint8Array, type: PhotoContentType): Uint8Array | null {
  return type === "image/jpeg" ? stripJpeg(bytes) : stripPng(bytes);
}

const JPEG_DROPPED_MARKERS = new Set([0xe1, 0xed, 0xfe]);

function stripJpeg(bytes: Uint8Array): Uint8Array | null {
  const kept: Uint8Array[] = [bytes.subarray(0, 2)]; // SOI
  let offset = 2;
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    if (marker === 0xff) {
      offset += 1; // Fill byte before a marker.
      continue;
    }
    if (marker === 0xd9) {
      kept.push(bytes.subarray(offset, offset + 2)); // EOI before any scan: nothing to show.
      return null;
    }
    // Markers without a length: standalone (TEM, RSTn).
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      kept.push(bytes.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }
    if (offset + 3 >= bytes.length) return null;
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (length < 2 || offset + 2 + length > bytes.length) return null;
    if (marker === 0xda) {
      // Start of scan: the entropy-coded data and everything after it is copied unchanged.
      kept.push(bytes.subarray(offset));
      return concat(kept);
    }
    if (!JPEG_DROPPED_MARKERS.has(marker)) kept.push(bytes.subarray(offset, offset + 2 + length));
    offset += 2 + length;
  }
  return null;
}

const PNG_SIGNATURE_LENGTH = 8;
const PNG_DROPPED_CHUNKS = new Set(["eXIf", "tEXt", "zTXt", "iTXt"]);

function stripPng(bytes: Uint8Array): Uint8Array | null {
  const kept: Uint8Array[] = [bytes.subarray(0, PNG_SIGNATURE_LENGTH)];
  let offset = PNG_SIGNATURE_LENGTH;
  let sawEnd = false;
  while (offset + 12 <= bytes.length) {
    const length =
      ((bytes[offset]! << 24) |
        (bytes[offset + 1]! << 16) |
        (bytes[offset + 2]! << 8) |
        bytes[offset + 3]!) >>>
      0;
    const end = offset + 12 + length; // length, type, data, CRC
    if (end > bytes.length) return null;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (!PNG_DROPPED_CHUNKS.has(type)) kept.push(bytes.subarray(offset, end));
    offset = end;
    if (type === "IEND") {
      sawEnd = true;
      break;
    }
  }
  return sawEnd ? concat(kept) : null;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export type CleanedPhoto = { bytes: Uint8Array; contentType: PhotoContentType };

export type PhotoRejection = "too_large" | "empty" | "not_an_image";

/**
 * Checks an uploaded photo and returns the bytes to store: size first (cheap), then the real type
 * by magic number, then metadata stripped. The client's file name and declared type are never read.
 */
export function cleanPhoto(
  bytes: Uint8Array,
): { ok: true; photo: CleanedPhoto } | { ok: false; reason: PhotoRejection } {
  if (bytes.length === 0) return { ok: false, reason: "empty" };
  if (bytes.length > PHOTO_MAX_BYTES) return { ok: false, reason: "too_large" };
  const contentType = sniffPhotoType(bytes);
  if (!contentType) return { ok: false, reason: "not_an_image" };
  const stripped = stripPhotoMetadata(bytes, contentType);
  if (!stripped) return { ok: false, reason: "not_an_image" };
  return { ok: true, photo: { bytes: stripped, contentType } };
}

export const PHOTO_REJECTION_MESSAGES: Record<PhotoRejection, string> = {
  empty: "The photo is empty. Take it again.",
  too_large: `The photo is too large (at most ${PHOTO_MAX_BYTES / (1024 * 1024)} MB). Take it again.`,
  not_an_image: "That file is not a JPEG or PNG photo.",
};

// ---------------------------------------------------------------------------------------------
// The proof itself
// ---------------------------------------------------------------------------------------------

/** The part of a proof the driver types and draws; the photo is a separate file. */
export const deliveryProofInputSchema = z.object({
  recipientName: z
    .string({ error: "Enter the recipient's printed name" })
    .trim()
    .min(1, "Enter the recipient's printed name")
    .max(RECIPIENT_NAME_MAX_LENGTH, `Use at most ${RECIPIENT_NAME_MAX_LENGTH} characters`),
  signature: z.preprocess(parseSignatureJson, signatureSchema.optional()),
});

/** A proof ready to be stored with the delivery. `photoKey` is set once the photo is in storage. */
export type DeliveryProofRecord = {
  recipientName: string;
  signature: Signature | null;
  photoKey: string | null;
};

/** What the public page, the webhook and the email may say about a proof (never the evidence). */
export type DeliveryProofSummary = {
  recipientName: string;
  hasSignature: boolean;
  hasPhoto: boolean;
};

export function summarizeProof(proof: DeliveryProofRecord): DeliveryProofSummary {
  return {
    recipientName: proof.recipientName,
    hasSignature: proof.signature !== null,
    hasPhoto: proof.photoKey !== null,
  };
}

/**
 * The photo key the demo's seed and simulator record: nothing is stored under it. The staff view
 * shows a placeholder image for it, so the feature can be seen without any visitor's file ever
 * being kept.
 */
export const DEMO_SAMPLE_PHOTO_KEY = "demo/sample";

/**
 * Whether the driver app offers photo capture: only with storage configured, and never in demo
 * mode (the public demo stores no visitor files).
 */
export function photoCaptureAvailable(config: {
  demoMode: boolean;
  blobToken: string | undefined;
}): boolean {
  return !config.demoMode && Boolean(config.blobToken);
}
