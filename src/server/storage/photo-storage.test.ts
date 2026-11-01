import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn(), del: vi.fn() }));
vi.mock("@vercel/blob", () => sdk);

import { createPhotoStorage } from "./index";
import { createMemoryPhotoStorage } from "./memory-photo-storage";
import { createVercelBlobPhotoStorage } from "./vercel-blob-photo-storage";

beforeEach(() => {
  sdk.put.mockReset();
  sdk.get.mockReset();
  sdk.del.mockReset();
});

describe("createPhotoStorage", () => {
  it("is null when photos are off, so nothing can be stored", () => {
    expect(createPhotoStorage({ enabled: false, blobToken: "vercel_blob_rw_x" })).toBeNull();
    expect(createPhotoStorage({ enabled: true, blobToken: undefined })).toBeNull();
  });

  it("is the Blob adapter when photos are on", async () => {
    const storage = createPhotoStorage({ enabled: true, blobToken: "vercel_blob_rw_x" });
    expect(storage).not.toBeNull();
    sdk.put.mockResolvedValue({});
    await storage!.put("k.jpg", new Uint8Array([1]), "image/jpeg");
    expect(sdk.put).toHaveBeenCalledOnce();
  });
});

describe("the Vercel Blob adapter", () => {
  const storage = createVercelBlobPhotoStorage("vercel_blob_rw_token");

  it("stores photos privately, under the key it was given, never overwriting", async () => {
    sdk.put.mockResolvedValue({});
    await storage.put("delivery-proofs/o/s/x.jpg", new Uint8Array([1, 2, 3]), "image/jpeg");

    const [pathname, body, options] = sdk.put.mock.calls[0]!;
    expect(pathname).toBe("delivery-proofs/o/s/x.jpg");
    expect([...body]).toEqual([1, 2, 3]);
    expect(options).toMatchObject({
      access: "private",
      contentType: "image/jpeg",
      token: "vercel_blob_rw_token",
      addRandomSuffix: false,
      allowOverwrite: false,
    });
  });

  it("reads privately and hands back the stream and type", async () => {
    const stream = new Response("bytes").body!;
    sdk.get.mockResolvedValue({ statusCode: 200, stream, blob: { contentType: "image/png" } });

    const photo = await storage.get("k.png");
    expect(sdk.get).toHaveBeenCalledWith("k.png", {
      access: "private",
      token: "vercel_blob_rw_token",
    });
    expect(photo).toEqual({ body: stream, contentType: "image/png" });
  });

  it("reports a missing photo as null", async () => {
    sdk.get.mockResolvedValue(null);
    expect(await storage.get("gone.jpg")).toBeNull();
    sdk.get.mockResolvedValue({ statusCode: 304, stream: null, blob: {} });
    expect(await storage.get("gone.jpg")).toBeNull();
  });

  it("deletes with the token", async () => {
    sdk.del.mockResolvedValue(undefined);
    await storage.delete("k.jpg");
    expect(sdk.del).toHaveBeenCalledWith("k.jpg", { token: "vercel_blob_rw_token" });
  });
});

describe("the in-memory fake", () => {
  it("stores, serves and removes, and records what happened", async () => {
    const storage = createMemoryPhotoStorage();
    await storage.put("k.jpg", new Uint8Array([9, 8]), "image/jpeg");
    const photo = await storage.get("k.jpg");
    expect(photo?.contentType).toBe("image/jpeg");
    expect([...new Uint8Array(await new Response(photo!.body).arrayBuffer())]).toEqual([9, 8]);

    await storage.delete("k.jpg");
    expect(await storage.get("k.jpg")).toBeNull();
    expect(storage.puts).toEqual(["k.jpg"]);
    expect(storage.deletes).toEqual(["k.jpg"]);
  });
});
