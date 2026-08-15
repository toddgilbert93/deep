import { createHash } from "node:crypto";

import {
  FileImageAssetStore,
  type ImageAssetStore,
  type StoredImageAsset,
} from "../assets/file-image-asset-store";
import { fetchBinaryResource } from "./fetch-webpage-source";
import type {
  ParsedWebpageUi,
  UiImageAsset,
  UiImageAssetSource,
} from "./parse-webpage-ui";
import type { WebpageSource } from "./fetch-webpage-source";

const DEFAULT_MAX_IMAGES = 30;
const DEFAULT_MAX_IMAGE_BYTES = 10_000_000;
const DEFAULT_MAX_TOTAL_BYTES = 50_000_000;

export interface CacheWebpageImagesOptions {
  allowPrivateNetwork?: boolean;
  fetchImpl?: typeof fetch;
  maxImages?: number;
  maxImageBytes?: number;
  maxTotalBytes?: number;
  timeoutMs?: number;
}

interface LoadedImage {
  cacheKey: string;
  displayUrl: string;
  finalUrl: string;
  mimeType: string;
  data?: Uint8Array;
}

interface ImageIdentity {
  cacheKey: string;
  displayUrl: string;
  resolvedUrl?: string;
}

export async function cacheWebpageImages(
  source: WebpageSource,
  parsed: ParsedWebpageUi,
  store: ImageAssetStore = new FileImageAssetStore(),
  options: CacheWebpageImagesOptions = {},
): Promise<ParsedWebpageUi> {
  const maxImages = options.maxImages ?? DEFAULT_MAX_IMAGES;
  const maxImageBytes = options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const elements = parsed.elements.map((element) => ({ ...element }));
  const imagesById = new Map<string, UiImageAsset>();
  const warnings = [...parsed.warnings];
  const imageElements = elements
    .filter((element) => element.tag === "img")
    .filter((element) => getImageReference(element.attributes))
    .slice(0, maxImages);
  let totalBytes = 0;

  if (
    elements.filter((element) => element.tag === "img").length > maxImages
  ) {
    warnings.push(`Image limit reached: only the first ${maxImages} images were cached.`);
  }

  for (const element of imageElements) {
    const reference = getImageReference(element.attributes);
    if (!reference) {
      continue;
    }

    try {
      const identity = identifyImage(source.finalUrl, reference);
      const cached = await store.findBySourceUrl(identity.cacheKey);
      const loaded = cached
        ? {
            ...identity,
            finalUrl: identity.resolvedUrl ?? identity.displayUrl,
            mimeType: cached.mimeType,
          }
        : await loadImage(identity, reference, {
            ...options,
            maxImageBytes,
          });
      let stored: StoredImageAsset;
      let cacheHit: boolean;

      if (cached) {
        stored = cached;
        cacheHit = true;
      } else {
        if (!loaded.data) {
          throw new Error("Image data was not loaded for an uncached asset.");
        }
        if (totalBytes + loaded.data.byteLength > maxTotalBytes) {
          warnings.push(
            `Image byte budget reached at ${maxTotalBytes} bytes; remaining images were skipped.`,
          );
          break;
        }
        stored = await store.put(loaded.cacheKey, loaded.mimeType, loaded.data);
        totalBytes += loaded.data.byteLength;
        cacheHit = false;
      }

      element.assetId = stored.id;
      const assetSource: UiImageAssetSource = {
        url: loaded.displayUrl,
        finalUrl: loaded.finalUrl,
        cacheHit,
      };
      const existing = imagesById.get(stored.id);
      if (existing) {
        if (!existing.sources.some((item) => item.url === assetSource.url)) {
          existing.sources.push(assetSource);
        }
      } else {
        imagesById.set(stored.id, {
          ...stored,
          sources: [assetSource],
        });
      }
    } catch (error) {
      warnings.push(
        `Image ${JSON.stringify(reference)} was not cached: ${getErrorMessage(error)}`,
      );
    }
  }

  const images = [...imagesById.values()];
  const result: ParsedWebpageUi = {
    ...parsed,
    elements,
    assets: { ...parsed.assets, images },
    stats: {
      ...parsed.stats,
      imageAssets: images.length,
      imageBytes: images.reduce((sum, image) => sum + image.bytes, 0),
      estimatedTokens: 0,
    },
    warnings,
  };
  result.stats.estimatedTokens = Math.ceil(
    Buffer.byteLength(JSON.stringify(result)) / 4,
  );
  return result;
}

async function loadImage(
  identity: ImageIdentity,
  reference: string,
  options: CacheWebpageImagesOptions & { maxImageBytes: number },
): Promise<LoadedImage> {
  if (reference.startsWith("data:")) {
    return loadDataImage(reference, options.maxImageBytes);
  }

  if (!identity.resolvedUrl) {
    throw new Error("Image URL did not resolve to HTTP or HTTPS.");
  }

  const resource = await fetchBinaryResource(identity.resolvedUrl, {
    allowPrivateNetwork: options.allowPrivateNetwork,
    fetchImpl: options.fetchImpl,
    maxBytes: options.maxImageBytes,
    timeoutMs: options.timeoutMs,
    userAgent: "DeepWebpageEvaluator/0.1 (+image-collection)",
  });
  return {
    ...identity,
    finalUrl: resource.finalUrl,
    mimeType: detectImageMimeType(resource.contentType, resource.data),
    data: resource.data,
  };
}

function identifyImage(pageUrl: string, reference: string): ImageIdentity {
  if (reference.startsWith("data:")) {
    const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(reference);
    if (!match) {
      throw new Error("Invalid data URL.");
    }
    const declaredMimeType = (match[1] || "text/plain").toLowerCase();
    if (!declaredMimeType.startsWith("image/")) {
      throw new Error("Data URL is not an image.");
    }
    const data = match[2]
      ? Buffer.from(match[3], "base64")
      : Buffer.from(decodeURIComponent(match[3]), "utf8");
    const sha256 = createHash("sha256").update(data).digest("hex");
    const displayUrl = `data:${declaredMimeType};sha256=${sha256}`;
    return { cacheKey: displayUrl, displayUrl };
  }

  const resolved = new URL(reference, pageUrl);
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
    throw new Error(`Unsupported image URL protocol ${resolved.protocol}`);
  }
  return {
    cacheKey: resolved.href,
    displayUrl: resolved.href,
    resolvedUrl: resolved.href,
  };
}

function loadDataImage(reference: string, maxBytes: number): LoadedImage {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(reference);
  if (!match) {
    throw new Error("Invalid data URL.");
  }
  const declaredMimeType = (match[1] || "text/plain").toLowerCase();
  if (!declaredMimeType.startsWith("image/")) {
    throw new Error("Data URL is not an image.");
  }
  const data = match[2]
    ? Buffer.from(match[3], "base64")
    : Buffer.from(decodeURIComponent(match[3]), "utf8");
  if (data.byteLength > maxBytes) {
    throw new Error(`Image exceeds the ${maxBytes}-byte limit.`);
  }
  const sha256 = createHash("sha256").update(data).digest("hex");
  const displayUrl = `data:${declaredMimeType};sha256=${sha256}`;
  return {
    cacheKey: displayUrl,
    displayUrl,
    finalUrl: displayUrl,
    mimeType: detectImageMimeType(declaredMimeType, data),
    data,
  };
}

function getImageReference(
  attributes: Record<string, string> | undefined,
): string | undefined {
  const direct = attributes?.src || attributes?.["data-src"];
  if (direct) {
    return direct;
  }
  const firstSrcsetCandidate = attributes?.srcset
    ?.split(",", 1)[0]
    ?.trim()
    .split(/\s+/, 1)[0];
  return firstSrcsetCandidate || undefined;
}

function detectImageMimeType(
  declaredMimeType: string,
  data: Uint8Array,
): string {
  const declared = declaredMimeType.toLowerCase();
  if (declared.startsWith("image/")) {
    return declared;
  }
  if (startsWithBytes(data, [0x89, 0x50, 0x4e, 0x47])) {
    return "image/png";
  }
  if (startsWithBytes(data, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  const prefix = new TextDecoder().decode(data.slice(0, 512));
  if (prefix.startsWith("GIF8")) {
    return "image/gif";
  }
  if (prefix.startsWith("RIFF") && prefix.slice(8, 12) === "WEBP") {
    return "image/webp";
  }
  if (/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(prefix)) {
    return "image/svg+xml";
  }
  if (prefix.slice(4, 12).includes("ftypavif")) {
    return "image/avif";
  }
  throw new Error(
    `Resource is not a recognized image (content type ${JSON.stringify(declaredMimeType)}).`,
  );
}

function startsWithBytes(data: Uint8Array, expected: number[]): boolean {
  return expected.every((value, index) => data[index] === value);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
