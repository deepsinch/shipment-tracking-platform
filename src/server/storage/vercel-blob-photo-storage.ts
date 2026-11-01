import { del, get, put } from "@vercel/blob";

import type { PhotoStorage } from "./photo-storage";

/**
 * Photos in a Vercel Blob store, with `access: "private"`: the blob has no public URL and every
 * read needs the store's token, which only this server has. The route handler that serves a photo
 * to staff calls `get` here after checking the session, so there is no link to leak, share or
 * outlive a removed member's access (a signed URL would still work for its whole lifetime).
 *
 * The SDK is checked against @vercel/blob 2.8 (`put`, `get`, `del` with `access`). Not exercised
 * against the real service from CI: the unit test pins the arguments with a mocked SDK.
 */
export function createVercelBlobPhotoStorage(token: string): PhotoStorage {
  return {
    async put(key, bytes, contentType) {
      await put(key, Buffer.from(bytes), {
        access: "private",
        contentType,
        token,
        // The key already ends in a random id, and a photo is never replaced.
        addRandomSuffix: false,
        allowOverwrite: false,
      });
    },
    async get(key) {
      const result = await get(key, { access: "private", token });
      if (!result || result.statusCode !== 200) return null;
      return { body: result.stream, contentType: result.blob.contentType };
    },
    async delete(key) {
      await del(key, { token });
    },
  };
}
