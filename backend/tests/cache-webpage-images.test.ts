import assert from "node:assert/strict";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { FileImageAssetStore } from "../src/assets/file-image-asset-store";
import { cacheWebpageImages } from "../src/webpage/cache-webpage-images";
import { fetchWebpageSource } from "../src/webpage/fetch-webpage-source";
import { parseWebpageUi } from "../src/webpage/parse-webpage-ui";

const fixtureDirectory = path.join(
  process.cwd(),
  "backend/tests/fixtures/simple-site",
);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("persists image assets and reuses the URL cache", async (t) => {
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "deep-image-assets-"),
  );
  const storageDirectory = path.join(temporaryDirectory, "storage");
  const cacheDirectory = path.join(temporaryDirectory, "cache");
  const indexHtml = await readFile(
    path.join(fixtureDirectory, "index.html"),
    "utf8",
  );
  const appJavaScript = await readFile(
    path.join(fixtureDirectory, "app.js"),
    "utf8",
  );
  let imageRequests = 0;
  const server = createServer((request, response) => {
    if (request.url === "/app.js") {
      response.writeHead(200, { "Content-Type": "application/javascript" });
      response.end(appJavaScript);
      return;
    }
    if (request.url === "/product.png") {
      imageRequests += 1;
      response.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": String(png.byteLength),
      });
      response.end(png);
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(indexHtml);
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  const { port } = server.address() as AddressInfo;
  const source = await fetchWebpageSource(`http://127.0.0.1:${port}`, {
    allowPrivateNetwork: true,
  });
  const parsed = parseWebpageUi(source);
  const firstStore = new FileImageAssetStore({
    storageDirectory,
    cacheDirectory,
  });
  const first = await cacheWebpageImages(source, parsed, firstStore, {
    allowPrivateNetwork: true,
  });

  assert.equal(first.assets.images.length, 1);
  assert.equal(first.assets.images[0].mimeType, "image/png");
  assert.equal(first.assets.images[0].bytes, png.byteLength);
  assert.equal(first.assets.images[0].sources[0].cacheHit, false);
  assert.equal(first.stats.imageAssets, 1);
  const imageElement = first.elements.find(
    (element) => element.tag === "img" && element.name === "Product preview",
  );
  assert.equal(imageElement?.assetId, first.assets.images[0].id);
  assert.deepEqual(
    await readFile(
      firstStore.resolveStorageKey(first.assets.images[0].storageKey),
    ),
    png,
  );
  const metadata = JSON.parse(
    await readFile(
      firstStore.resolveStorageKey(first.assets.images[0].metadataKey),
      "utf8",
    ),
  ) as { sourceUrls: string[] };
  assert.deepEqual(metadata.sourceUrls, [
    `http://127.0.0.1:${port}/product.png`,
  ]);

  const secondStore = new FileImageAssetStore({
    storageDirectory,
    cacheDirectory,
  });
  const second = await cacheWebpageImages(source, parsed, secondStore, {
    allowPrivateNetwork: true,
  });
  assert.equal(second.assets.images[0].sources[0].cacheHit, true);
  assert.equal(imageRequests, 1);
});
