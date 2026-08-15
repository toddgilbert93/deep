import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export interface StoredImageAsset {
  id: string;
  sha256: string;
  mimeType: string;
  bytes: number;
  storageKey: string;
  metadataKey: string;
}

export interface ImageAssetStore {
  findBySourceUrl(sourceUrl: string): Promise<StoredImageAsset | undefined>;
  put(
    sourceUrl: string,
    mimeType: string,
    data: Uint8Array,
  ): Promise<StoredImageAsset>;
}

export interface FileImageAssetStoreOptions {
  storageDirectory?: string;
  cacheDirectory?: string;
}

interface UrlCacheManifest {
  version: 1;
  entries: Record<string, StoredImageAsset>;
}

interface PersistentAssetMetadata extends StoredImageAsset {
  sourceUrls: string[];
}

export class FileImageAssetStore implements ImageAssetStore {
  readonly storageDirectory: string;
  readonly cacheDirectory: string;

  private cacheManifest?: UrlCacheManifest;

  constructor(options: FileImageAssetStoreOptions = {}) {
    this.storageDirectory = path.resolve(
      options.storageDirectory ??
        process.env.WEBPAGE_ASSET_STORAGE_DIR ??
        path.join(process.cwd(), "backend/storage/webpage-assets"),
    );
    this.cacheDirectory = path.resolve(
      options.cacheDirectory ??
        process.env.WEBPAGE_ASSET_CACHE_DIR ??
        path.join(process.cwd(), "backend/.cache/webpage-assets"),
    );
  }

  async findBySourceUrl(
    sourceUrl: string,
  ): Promise<StoredImageAsset | undefined> {
    const manifest = await this.loadCacheManifest();
    const asset = manifest.entries[sourceUrl];
    if (!asset) {
      return undefined;
    }

    try {
      await access(this.resolveStorageKey(asset.storageKey));
      return asset;
    } catch {
      delete manifest.entries[sourceUrl];
      await this.saveCacheManifest();
      return undefined;
    }
  }

  async put(
    sourceUrl: string,
    mimeType: string,
    data: Uint8Array,
  ): Promise<StoredImageAsset> {
    const sha256 = createHash("sha256").update(data).digest("hex");
    const extension = extensionForMimeType(mimeType);
    const storageKey = path.posix.join("images", `${sha256}.${extension}`);
    const metadataKey = path.posix.join("metadata", `${sha256}.json`);
    const asset: StoredImageAsset = {
      id: `asset_${sha256.slice(0, 24)}`,
      sha256,
      mimeType,
      bytes: data.byteLength,
      storageKey,
      metadataKey,
    };

    await mkdir(path.dirname(this.resolveStorageKey(storageKey)), {
      recursive: true,
    });
    await mkdir(path.dirname(this.resolveStorageKey(metadataKey)), {
      recursive: true,
    });
    await writeFileIfMissing(this.resolveStorageKey(storageKey), data);
    const metadataPath = this.resolveStorageKey(metadataKey);
    const existingMetadata = await readAssetMetadata(metadataPath);
    const metadata: PersistentAssetMetadata = {
      ...asset,
      sourceUrls: [
        ...new Set([...(existingMetadata?.sourceUrls ?? []), sourceUrl]),
      ],
    };
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

    const manifest = await this.loadCacheManifest();
    manifest.entries[sourceUrl] = asset;
    await this.saveCacheManifest();
    return asset;
  }

  /**
   * Looks up a stored asset by its public ID (`asset_` + first 24 hex chars of
   * the SHA-256). Returns `undefined` when the ID is malformed, no metadata
   * sidecar matches, or the image file is missing.
   */
  async findById(assetId: string): Promise<StoredImageAsset | undefined> {
    const match = /^asset_([0-9a-f]{24})$/.exec(assetId);
    if (!match) {
      return undefined;
    }

    const prefix = match[1];
    let entries: string[];
    try {
      entries = await readdir(path.join(this.storageDirectory, "metadata"));
    } catch {
      return undefined;
    }

    for (const entry of entries) {
      if (!entry.startsWith(prefix) || !entry.endsWith(".json")) {
        continue;
      }
      const metadata = await readAssetMetadata(
        path.join(this.storageDirectory, "metadata", entry),
      );
      if (!metadata || metadata.id !== assetId) {
        continue;
      }
      try {
        await access(this.resolveStorageKey(metadata.storageKey));
      } catch {
        return undefined;
      }
      return {
        id: metadata.id,
        sha256: metadata.sha256,
        mimeType: metadata.mimeType,
        bytes: metadata.bytes,
        storageKey: metadata.storageKey,
        metadataKey: metadata.metadataKey,
      };
    }

    return undefined;
  }

  resolveStorageKey(storageKey: string): string {
    const resolved = path.resolve(this.storageDirectory, storageKey);
    const relative = path.relative(this.storageDirectory, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Asset storage key escapes its storage directory.");
    }
    return resolved;
  }

  private async loadCacheManifest(): Promise<UrlCacheManifest> {
    if (this.cacheManifest) {
      return this.cacheManifest;
    }

    const manifestPath = path.join(this.cacheDirectory, "url-index.json");
    try {
      const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as Partial<UrlCacheManifest>;
      this.cacheManifest = {
        version: 1,
        entries:
          parsed.version === 1 && isRecord(parsed.entries)
            ? (parsed.entries as Record<string, StoredImageAsset>)
            : {},
      };
    } catch {
      this.cacheManifest = { version: 1, entries: {} };
    }
    return this.cacheManifest;
  }

  private async saveCacheManifest(): Promise<void> {
    const manifest = await this.loadCacheManifest();
    await mkdir(this.cacheDirectory, { recursive: true });
    const manifestPath = path.join(this.cacheDirectory, "url-index.json");
    const temporaryPath = path.join(
      this.cacheDirectory,
      `url-index.${process.pid}.${Date.now()}.tmp`,
    );
    await writeFile(
      temporaryPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    await rename(temporaryPath, manifestPath);
  }
}

async function writeFileIfMissing(
  filePath: string,
  data: Uint8Array,
): Promise<void> {
  try {
    await writeFile(filePath, data, { flag: "wx" });
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EEXIST") {
      throw error;
    }
  }
}

function extensionForMimeType(mimeType: string): string {
  const extensions: Record<string, string> = {
    "image/avif": "avif",
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/svg+xml": "svg",
    "image/webp": "webp",
  };
  return extensions[mimeType] ?? "img";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function readAssetMetadata(
  filePath: string,
): Promise<PersistentAssetMetadata | undefined> {
  try {
    const value = JSON.parse(await readFile(filePath, "utf8")) as Partial<PersistentAssetMetadata>;
    return Array.isArray(value.sourceUrls)
      ? (value as PersistentAssetMetadata)
      : undefined;
  } catch {
    return undefined;
  }
}
