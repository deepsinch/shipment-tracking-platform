/**
 * Tiny, hand-built image files for photo tests: structurally valid as far as the code under test
 * looks (marker segments, chunks), carrying a recognisable "GPS" marker string where a camera
 * would put location metadata.
 */

export const GPS_MARKER = "GPSLatitude=51.9244 GPSLongitude=4.4777";

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));
const be16 = (value: number) => [(value >> 8) & 0xff, value & 0xff];
const be32 = (value: number) => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
];

/** A JPEG: JFIF header, EXIF (with GPS text), a comment, an ICC profile, then the scan. */
export function jpegWithExif(scanBytes = 64): Uint8Array {
  const segment = (marker: number, payload: number[]) => [
    0xff,
    marker,
    ...be16(payload.length + 2),
    ...payload,
  ];
  return new Uint8Array([
    0xff,
    0xd8,
    ...segment(0xe0, [...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...segment(0xe1, [...ascii("Exif"), 0, 0, ...ascii(GPS_MARKER)]),
    ...segment(0xe1, [...ascii("http://ns.adobe.com/xap/1.0/"), 0, ...ascii(GPS_MARKER)]),
    ...segment(0xfe, ascii(`taken at ${GPS_MARKER}`)),
    ...segment(0xe2, [...ascii("ICC_PROFILE"), 0, 1, 1, ...ascii("colours")]),
    ...segment(0xda, [1, 1, 0, 0, 0x3f, 0]),
    ...Array.from({ length: scanBytes }, (_, index) => (index * 7 + 3) & 0x7f),
    0xff,
    0xd9,
  ]);
}

/** A PNG: header, an EXIF chunk and text chunks carrying the GPS text, then image data. */
export function pngWithMetadata(): Uint8Array {
  const chunk = (type: string, data: number[]) => [
    ...be32(data.length),
    ...ascii(type),
    ...data,
    0,
    0,
    0,
    0, // CRC: not checked by the code under test.
  ];
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]),
    ...chunk("eXIf", ascii(GPS_MARKER)),
    ...chunk("tEXt", ascii(`Comment\0${GPS_MARKER}`)),
    ...chunk("iTXt", ascii(`XML:com.adobe.xmp\0${GPS_MARKER}`)),
    ...chunk("IDAT", [0x78, 0x9c, 0x63, 0x60, 0, 0, 0, 4, 0, 1]),
    ...chunk("IEND", []),
  ]);
}

export const asText = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

export function blobOf(bytes: Uint8Array, type = "image/jpeg"): Blob {
  return new Blob([bytes as BlobPart], { type });
}
