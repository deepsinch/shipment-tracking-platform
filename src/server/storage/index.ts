import "server-only";

import { env } from "@/server/env";

import type { PhotoStorage } from "./photo-storage";
import { createVercelBlobPhotoStorage } from "./vercel-blob-photo-storage";

export type { PhotoStorage, StoredPhoto } from "./photo-storage";

/**
 * The storage for a photo configuration (`env.photos`), or null when photos are off: no Blob
 * token, or demo mode, which never keeps a visitor's file. Null means no code path can store a
 * photo, so "demo mode stores nothing" does not depend on the UI hiding a button.
 */
export function createPhotoStorage(photos: {
  enabled: boolean;
  blobToken: string | undefined;
}): PhotoStorage | null {
  return photos.enabled && photos.blobToken ? createVercelBlobPhotoStorage(photos.blobToken) : null;
}

let configured: PhotoStorage | null | undefined;

/** This deployment's photo storage, created on first use so importing needs no environment. */
export function getPhotoStorage(): PhotoStorage | null {
  if (configured === undefined) configured = createPhotoStorage(env.photos);
  return configured;
}
