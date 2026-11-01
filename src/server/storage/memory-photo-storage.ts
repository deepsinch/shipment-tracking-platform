import type { PhotoContentType } from "@/domain/delivery-proof";

import type { PhotoStorage, StoredPhoto } from "./photo-storage";

/**
 * Photos kept in memory: the fake that tests (and a local run without a Blob store, should one
 * want it) use. `puts` and `deletes` record what happened, so a test can assert that nothing was
 * stored.
 */
export type MemoryPhotoStorage = PhotoStorage & {
  readonly files: ReadonlyMap<string, { bytes: Uint8Array; contentType: PhotoContentType }>;
  readonly puts: string[];
  readonly deletes: string[];
};

export function createMemoryPhotoStorage(): MemoryPhotoStorage {
  const files = new Map<string, { bytes: Uint8Array; contentType: PhotoContentType }>();
  const puts: string[] = [];
  const deletes: string[] = [];
  return {
    files,
    puts,
    deletes,
    async put(key, bytes, contentType) {
      puts.push(key);
      files.set(key, { bytes, contentType });
    },
    async get(key): Promise<StoredPhoto | null> {
      const file = files.get(key);
      if (!file) return null;
      return {
        contentType: file.contentType,
        body: new Response(file.bytes as BodyInit).body!,
      };
    },
    async delete(key) {
      deletes.push(key);
      files.delete(key);
    },
  };
}
