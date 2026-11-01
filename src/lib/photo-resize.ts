/**
 * Shrinks a photo in the browser before it is uploaded. Drawing it onto a canvas and encoding it
 * again also drops everything the camera put in the file (EXIF location, device details), applies
 * the camera's rotation, and turns formats the server does not take (HEIC, WebP) into JPEG. The
 * server checks and strips again: this is for the driver's data plan and privacy, not a boundary.
 */

/** The longest edge of the uploaded photo. Plenty to read a parcel on a doorstep. */
export const PHOTO_MAX_EDGE = 1600;
export const PHOTO_QUALITY = 0.82;

/** The size to draw an image of `width` x `height` at so neither edge passes `maxEdge`. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number = PHOTO_MAX_EDGE,
): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export type ResizedPhoto = {
  blob: Blob;
  /** A `data:` URL for the preview (the page's CSP allows data: images, not blob: ones). */
  previewUrl: string;
};

/** Returns null when the browser cannot read the file as an image. */
export async function resizePhoto(file: File): Promise<ResizedPhoto | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return null;
  }
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", PHOTO_QUALITY),
    );
    if (!blob) return null;
    return { blob, previewUrl: await readAsDataUrl(blob) };
  } finally {
    bitmap.close();
  }
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
