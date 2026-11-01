import type { PhotoContentType } from "@/domain/delivery-proof";

/**
 * Where delivery photos live. A small interface (rather than calls to a vendor SDK in the
 * services) so the services are tested against an in-memory fake, and so a different store is a
 * new adapter, not a rewrite. Photos are private: nothing here hands out a public or signed URL.
 * Staff see them through a route handler that checks the session and streams the bytes.
 */
export interface PhotoStorage {
  put(key: string, bytes: Uint8Array, contentType: PhotoContentType): Promise<void>;
  /** The stored photo as a stream, or null when there is nothing under `key`. */
  get(key: string): Promise<StoredPhoto | null>;
  /** Removes a photo; removing one that is not there is not an error. */
  delete(key: string): Promise<void>;
}

export type StoredPhoto = { body: ReadableStream<Uint8Array>; contentType: string };
