/**
 * `GET /api/assets/{assetId}` — serves a locally cached, content-addressed
 * webpage image from the backend asset store. See `openapi.yaml`.
 *
 * Only `image/*` bytes are ever returned, and SVG responses are sandboxed with
 * a strict Content-Security-Policy so embedded scripts cannot run.
 */
import { readFile } from "node:fs/promises";

import { FileImageAssetStore } from "../../../../../backend/src/assets/file-image-asset-store";

const ASSET_ID_PATTERN = /^asset_[0-9a-f]{24}$/;
const IMAGE_MIME_PATTERN = /^image\/[a-z0-9.+-]+$/i;

function jsonError(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function notFound(): Response {
  return jsonError(404, "ASSET_NOT_FOUND", "No stored asset matches the requested ID.");
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assetId: string }> },
): Promise<Response> {
  const { assetId } = await params;
  if (!ASSET_ID_PATTERN.test(assetId)) {
    return jsonError(
      400,
      "INVALID_ASSET_ID",
      "The asset ID must match asset_ followed by 24 lowercase hexadecimal characters.",
    );
  }

  const store = new FileImageAssetStore();
  const asset = await store.findById(assetId);
  if (!asset) {
    return notFound();
  }
  if (!IMAGE_MIME_PATTERN.test(asset.mimeType)) {
    return notFound();
  }

  let filePath: string;
  try {
    filePath = store.resolveStorageKey(asset.storageKey);
  } catch {
    return notFound();
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") {
      return notFound();
    }
    console.error(
      "[api/assets] failed to read asset:",
      error instanceof Error ? error.message : String(error),
    );
    return jsonError(500, "ASSET_READ_FAILED", "The asset could not be read.");
  }

  const mimeType = asset.mimeType.toLowerCase();
  const headers = new Headers({
    "Content-Type": mimeType,
    "Content-Length": String(bytes.byteLength),
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  });
  if (mimeType === "image/svg+xml") {
    headers.set(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
  }

  // Copy into a plain ArrayBuffer-backed view so the body type is a valid BodyInit.
  return new Response(new Uint8Array(bytes), { status: 200, headers });
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
