import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { FileImageAssetStore } from "../src/assets/file-image-asset-store";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function createTemporaryStore(): Promise<{
  store: FileImageAssetStore;
  cleanup: () => Promise<void>;
}> {
  const directory = await mkdtemp(path.join(tmpdir(), "deep-asset-store-"));
  const store = new FileImageAssetStore({
    storageDirectory: path.join(directory, "storage"),
    cacheDirectory: path.join(directory, "cache"),
  });
  return {
    store,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

test("findById returns a stored asset by its public ID", async (t) => {
  const { store, cleanup } = await createTemporaryStore();
  t.after(cleanup);

  const stored = await store.put(
    "https://example.com/product.png",
    "image/png",
    png,
  );
  const sha256 = createHash("sha256").update(png).digest("hex");
  assert.equal(stored.id, `asset_${sha256.slice(0, 24)}`);

  const found = await store.findById(stored.id);
  assert.deepEqual(found, stored);
  assert.equal(found?.mimeType, "image/png");
  assert.equal(found?.storageKey, `images/${sha256}.png`);
  assert.equal(found?.metadataKey, `metadata/${sha256}.json`);
});

test("findById returns undefined for malformed IDs without touching storage", async (t) => {
  const { store, cleanup } = await createTemporaryStore();
  t.after(cleanup);

  for (const malformed of [
    "",
    "asset_",
    "asset_../../etc/passwd",
    "asset_ABCDEF0123456789abcdef01",
    "asset_0123456789abcdef0123456",
    "asset_0123456789abcdef0123456789",
    "image_0123456789abcdef01234567",
    "0123456789abcdef01234567",
  ]) {
    assert.equal(await store.findById(malformed), undefined, malformed);
  }
});

test("findById returns undefined for unknown IDs and missing image files", async (t) => {
  const { store, cleanup } = await createTemporaryStore();
  t.after(cleanup);

  // Empty store: the metadata directory does not exist yet.
  assert.equal(
    await store.findById("asset_0123456789abcdef01234567"),
    undefined,
  );

  const stored = await store.put(
    "https://example.com/product.png",
    "image/png",
    png,
  );
  // Well-formed but unknown ID beside an existing asset.
  assert.equal(
    await store.findById("asset_ffffffffffffffffffffffff"),
    undefined,
  );

  // Metadata sidecar exists but the image bytes are gone.
  await unlink(store.resolveStorageKey(stored.storageKey));
  assert.equal(await store.findById(stored.id), undefined);
});
