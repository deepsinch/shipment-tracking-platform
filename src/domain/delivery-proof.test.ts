import { describe, expect, it } from "vitest";

import { asText, GPS_MARKER, jpegWithExif, pngWithMetadata } from "../../tests/photo-fixtures";
import {
  asSignature,
  cleanPhoto,
  deliveryProofInputSchema,
  parseSignatureJson,
  PHOTO_MAX_BYTES,
  photoCaptureAvailable,
  signatureDescription,
  signaturePaths,
  signatureSchema,
  SIGNATURE_MAX_BYTES,
  SIGNATURE_MAX_POINTS,
  sniffPhotoType,
  stripPhotoMetadata,
  summarizeProof,
  type Signature,
} from "./delivery-proof";

const scribble: Signature = {
  aspect: 2,
  strokes: [
    [
      [0.1, 0.5],
      [0.3, 0.4],
      [0.5, 0.6],
    ],
    [[0.7, 0.5]],
  ],
};

describe("signatureSchema", () => {
  it("accepts strokes of normalised points", () => {
    expect(signatureSchema.safeParse(scribble).success).toBe(true);
  });

  it.each([
    ["no strokes", { aspect: 2, strokes: [] }],
    ["an empty stroke", { aspect: 2, strokes: [[]] }],
    ["a point outside the pad", { aspect: 2, strokes: [[[1.2, 0.5]]] }],
    ["a negative point", { aspect: 2, strokes: [[[-0.1, 0.5]]] }],
    ["a point with three numbers", { aspect: 2, strokes: [[[0.1, 0.5, 0.2]]] }],
    ["a missing aspect", { strokes: [[[0.1, 0.5]]] }],
    ["an absurd aspect", { aspect: 100, strokes: [[[0.1, 0.5]]] }],
    ["extra keys", { aspect: 2, strokes: [[[0.1, 0.5]]], note: "hi" }],
    ["text", "hello"],
    ["null", null],
  ])("rejects %s", (_label, value) => {
    expect(signatureSchema.safeParse(value).success).toBe(false);
  });

  it("caps the number of points", () => {
    const stroke = Array.from({ length: SIGNATURE_MAX_POINTS }, () => [0.5, 0.5] as const);
    expect(signatureSchema.safeParse({ aspect: 2, strokes: [stroke] }).success).toBe(true);
    expect(signatureSchema.safeParse({ aspect: 2, strokes: [stroke, [[0.1, 0.1]]] }).success).toBe(
      false,
    );
  });

  it("caps the stored size in bytes", () => {
    // Few points with long numbers: under the point cap, over the byte cap.
    const point = [0.123456789012345, 0.123456789012345] as const;
    const strokes = Array.from({ length: 80 }, () => Array.from({ length: 20 }, () => point));
    const signature = { aspect: 2, strokes };
    expect(JSON.stringify(signature).length).toBeGreaterThan(SIGNATURE_MAX_BYTES);
    const result = signatureSchema.safeParse(signature);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("too large");
  });
});

describe("parseSignatureJson", () => {
  it("reads the JSON a form sends and treats blank as no signature", () => {
    expect(parseSignatureJson(JSON.stringify(scribble))).toEqual(scribble);
    expect(parseSignatureJson("")).toBeUndefined();
    expect(parseSignatureJson("  ")).toBeUndefined();
    expect(parseSignatureJson(undefined)).toBeUndefined();
  });

  it("leaves text that is not JSON for the schema to reject", () => {
    expect(parseSignatureJson("{not json")).toBe("{not json");
    const huge = "x".repeat(SIGNATURE_MAX_BYTES * 2 + 1);
    expect(parseSignatureJson(huge)).toBe(huge);
  });
});

describe("deliveryProofInputSchema", () => {
  it("needs a printed name, trimmed", () => {
    const ok = deliveryProofInputSchema.safeParse({ recipientName: "  Ada R.  " });
    expect(ok.success && ok.data.recipientName).toBe("Ada R.");
    for (const recipientName of ["", "   ", undefined, null, 5]) {
      expect(deliveryProofInputSchema.safeParse({ recipientName }).success).toBe(false);
    }
    expect(deliveryProofInputSchema.safeParse({ recipientName: "x".repeat(121) }).success).toBe(
      false,
    );
  });

  it("takes the signature as JSON text, optional", () => {
    const signed = deliveryProofInputSchema.safeParse({
      recipientName: "Ada",
      signature: JSON.stringify(scribble),
    });
    expect(signed.success && signed.data.signature).toEqual(scribble);

    const bad = deliveryProofInputSchema.safeParse({ recipientName: "Ada", signature: "{oops" });
    expect(bad.success).toBe(false);
    expect(JSON.stringify(bad.error?.issues)).toContain("could not be read");
  });
});

describe("signaturePaths", () => {
  it("scales normalised points to the viewBox and keeps the aspect ratio", () => {
    const { height, paths } = signaturePaths(scribble);
    expect(height).toBe(500);
    expect(paths[0]).toBe("M100 250 L300 200 L500 300");
  });

  it("draws a single tap as a zero-length segment, which a round cap shows as a dot", () => {
    expect(signaturePaths(scribble).paths[1]).toBe("M700 250 L700 250");
  });

  it("produces only path commands and numbers, whatever the input", () => {
    const { paths } = signaturePaths(scribble);
    for (const path of paths) expect(path).toMatch(/^[ML0-9. -]+$/);
  });
});

describe("asSignature and signatureDescription", () => {
  it("reads stored JSON back, or null when it is not a signature", () => {
    expect(asSignature(scribble)).toEqual(scribble);
    expect(asSignature({ anything: "else" })).toBeNull();
    expect(asSignature(null)).toBeNull();
  });

  it("describes the signature in words", () => {
    expect(signatureDescription(scribble)).toBe("A hand-drawn signature of 2 strokes.");
    expect(signatureDescription({ aspect: 2, strokes: [[[0.1, 0.1]]] })).toContain("1 stroke.");
    expect(signatureDescription(null)).toBe("No signature was drawn.");
  });
});

describe("summarizeProof", () => {
  it("reports what exists, not the evidence", () => {
    expect(
      summarizeProof({ recipientName: "Ada", signature: scribble, photoKey: "a/b.jpg" }),
    ).toEqual({ recipientName: "Ada", hasSignature: true, hasPhoto: true });
    expect(summarizeProof({ recipientName: "Ada", signature: null, photoKey: null })).toEqual({
      recipientName: "Ada",
      hasSignature: false,
      hasPhoto: false,
    });
  });
});

describe("photoCaptureAvailable", () => {
  it("needs a token and is never on in demo mode", () => {
    expect(photoCaptureAvailable({ demoMode: false, blobToken: "t" })).toBe(true);
    expect(photoCaptureAvailable({ demoMode: false, blobToken: undefined })).toBe(false);
    expect(photoCaptureAvailable({ demoMode: false, blobToken: "" })).toBe(false);
    expect(photoCaptureAvailable({ demoMode: true, blobToken: "t" })).toBe(false);
  });
});

describe("sniffPhotoType", () => {
  it("recognises JPEG and PNG by their first bytes", () => {
    expect(sniffPhotoType(jpegWithExif())).toBe("image/jpeg");
    expect(sniffPhotoType(pngWithMetadata())).toBe("image/png");
  });

  it.each([
    ["a GIF", [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]],
    ["a WebP", [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]],
    ["an SVG", Array.from(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))],
    ["HTML", Array.from(new TextEncoder().encode("<html><script>alert(1)</script>"))],
    ["a PDF", Array.from(new TextEncoder().encode("%PDF-1.7"))],
    ["nothing", []],
  ])("refuses %s", (_label, bytes) => {
    expect(sniffPhotoType(new Uint8Array(bytes))).toBeNull();
  });
});

describe("stripPhotoMetadata", () => {
  it("drops EXIF, XMP and comments from a JPEG and keeps the picture", () => {
    const original = jpegWithExif();
    expect(asText(original)).toContain(GPS_MARKER);

    const stripped = stripPhotoMetadata(original, "image/jpeg")!;
    const text = asText(stripped);
    expect(text).not.toContain("GPS");
    expect(text).not.toContain("Exif");
    expect(text).not.toContain("taken at");
    // Kept: JFIF header, the ICC profile and the scan through the end marker.
    expect(text).toContain("JFIF");
    expect(text).toContain("ICC_PROFILE");
    expect([...stripped.subarray(-2)]).toEqual([0xff, 0xd9]);
    // The scan data is byte-for-byte what it was.
    const scan = original.subarray(original.length - 66, original.length);
    expect([...stripped.subarray(stripped.length - 66)]).toEqual([...scan]);
    expect(stripped.length).toBeLessThan(original.length);
  });

  it("drops EXIF and text chunks from a PNG", () => {
    const stripped = stripPhotoMetadata(pngWithMetadata(), "image/png")!;
    const text = asText(stripped);
    expect(text).not.toContain("GPS");
    for (const dropped of ["eXIf", "tEXt", "iTXt"]) expect(text).not.toContain(dropped);
    for (const kept of ["IHDR", "IDAT", "IEND"]) expect(text).toContain(kept);
  });

  it("refuses a truncated file instead of storing half an image", () => {
    const jpeg = jpegWithExif();
    expect(stripPhotoMetadata(jpeg.subarray(0, 40), "image/jpeg")).toBeNull();
    const png = pngWithMetadata();
    expect(stripPhotoMetadata(png.subarray(0, png.length - 20), "image/png")).toBeNull();
    // A JPEG without a scan at all.
    expect(stripPhotoMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), "image/jpeg")).toBeNull();
  });
});

describe("cleanPhoto", () => {
  it("returns stripped bytes and the sniffed type", () => {
    const result = cleanPhoto(jpegWithExif());
    expect(result.ok && result.photo.contentType).toBe("image/jpeg");
    expect(result.ok && asText(result.photo.bytes)).not.toContain("GPS");
  });

  it("refuses empty, oversized and non-image files", () => {
    expect(cleanPhoto(new Uint8Array())).toEqual({ ok: false, reason: "empty" });
    expect(cleanPhoto(new Uint8Array(PHOTO_MAX_BYTES + 1))).toEqual({
      ok: false,
      reason: "too_large",
    });
    expect(cleanPhoto(new TextEncoder().encode("<svg onload=alert(1)>"))).toEqual({
      ok: false,
      reason: "not_an_image",
    });
  });

  it("checks the size before the content, so a file at the limit is judged on what it is", () => {
    expect(cleanPhoto(new Uint8Array(PHOTO_MAX_BYTES))).toEqual({
      ok: false,
      reason: "not_an_image",
    });
  });
});
