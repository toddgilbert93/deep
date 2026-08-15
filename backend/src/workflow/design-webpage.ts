/**
 * URL to 3D page, the short way.
 *
 * What this deliberately does NOT do, versus the previous spec pipeline:
 * - No JavaScript download or static analysis. The design call never sees it,
 *   and fetching up to 20 bundles was a large share of the wall clock.
 * - No 383-element selector graph, no per-element events, no coverage
 *   validation, no repair round.
 *
 * What is left is: fetch HTML (+ stylesheets for palette and type), cache the
 * images the brief references, build a compact brief, and stream one design
 * call, publishing parsed snapshots as the page builds.
 */
import { randomUUID } from "node:crypto";

import {
  FileImageAssetStore,
  type ImageAssetStore,
} from "../assets/file-image-asset-store";
import {
  extractDesignBrief,
  type DesignBrief,
  type DesignBriefImage,
} from "../design/design-brief";
import type { DesignPage, DesignTheme } from "../design/design-tree";
import {
  generateDesignPage,
  type DesignPageClient,
} from "../design/generate-page";
import { parseDesignPage } from "../design/parse-design-page";
import { GrokApiError, GrokConfigurationError } from "../providers/grok";
import {
  fetchBinaryResource,
  fetchWebpageSource,
  WebpageSourceError,
  type WebpageSource,
} from "../webpage/fetch-webpage-source";
import {
  createReconstructionEventEmitter,
  type ReconstructionEventSink,
} from "./reconstruction-events";

export class DesignAbortedError extends Error {
  constructor(message = "The conversion was cancelled.", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DesignAbortedError";
  }
}

export interface DesignWebpageOptions {
  url: string;
  allowPrivateNetwork?: boolean;
  jobId?: string;
  onEvent?: ReconstructionEventSink;
  client?: DesignPageClient;
  assetStore?: ImageAssetStore;
  signal?: AbortSignal;
  /** Minimum milliseconds between streamed preview snapshots. */
  snapshotIntervalMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface DesignWebpageResult {
  jobId: string;
  brief: DesignBrief;
  page: DesignPage;
  html: string;
  model: string;
  responseId: string;
}

const MAX_STYLESHEETS = 6;
const MAX_STYLESHEET_BYTES = 400_000;
const MAX_BRIEF_IMAGES = 12;
const DEFAULT_SNAPSHOT_INTERVAL_MS = 900;

export async function designWebpage(
  options: DesignWebpageOptions,
): Promise<DesignWebpageResult> {
  const jobId = options.jobId ?? `job_${randomUUID()}`;
  const emitter = createReconstructionEventEmitter(jobId, options.onEvent);
  const assetStore = options.assetStore ?? new FileImageAssetStore();
  const now = options.now ?? (() => Date.now());
  const snapshotInterval = options.snapshotIntervalMs ?? DEFAULT_SNAPSHOT_INTERVAL_MS;
  let progress = 0;

  const throwIfAborted = (): void => {
    if (options.signal?.aborted) throw new DesignAbortedError();
  };

  try {
    throwIfAborted();
    await emitter.emit("fetching_source", (progress = 4), {
      type: "workflow.status",
      status: "started",
      message: "Fetching the page.",
    });

    // maxScripts: 0 — the design call never reads JavaScript, and skipping the
    // bundles removes the largest fixed cost in the fetch stage.
    const source = await fetchWebpageSource(options.url, {
      allowPrivateNetwork: options.allowPrivateNetwork,
      maxScripts: 0,
      fetchImpl: options.fetchImpl,
    });
    throwIfAborted();

    await emitter.emit("fetching_source", (progress = 12), {
      type: "workflow.status",
      status: "completed",
      message: "Page source collected.",
    });

    await emitter.emit("parsing_dom", (progress = 16), {
      type: "workflow.status",
      status: "started",
      message: "Reading the layout, palette, and type.",
    });

    const stylesheets = await collectStylesheets(source, options);
    throwIfAborted();

    await emitter.emit("caching_assets", (progress = 22), {
      type: "workflow.status",
      status: "started",
      message: "Caching page images locally.",
    });
    const images = await cacheBriefImages(source, assetStore, options);
    throwIfAborted();
    await emitter.emit("caching_assets", (progress = 32), {
      type: "workflow.status",
      status: "completed",
      message: "Local images ready.",
      counts: { images: images.size },
    });

    const brief = extractDesignBrief(source, {
      stylesheets,
      resolveImage: (rawSrc) => images.get(normalizeImageKey(rawSrc, source.finalUrl)),
    });

    await emitter.emit("preparing_agent", (progress = 38), {
      type: "workflow.status",
      status: "completed",
      message: "Design brief ready.",
      counts: {
        elements: brief.stats.blocks,
        images: brief.stats.images,
      },
    });

    const briefTheme = {
      background: brief.palette.background,
      ink: brief.palette.ink,
      accent: brief.palette.accent,
      surface: brief.palette.surface,
      fontFamily: brief.fonts.body,
    };

    await emitter.emit("designing", (progress = 42), {
      type: "workflow.status",
      status: "started",
      message: "Grok is designing the 3D page.",
    });

    let lastSnapshot = 0;
    let snapshots = 0;

    const result = await generateDesignPage(brief, {
      client: options.client,
      signal: options.signal,
      onFirstDelta: async () => {
        await emitter.emit("rendering", (progress = 55), {
          type: "workflow.status",
          status: "progress",
          message: "The page is coming through.",
        });
      },
      onDelta: async (_delta, html) => {
        const timestamp = now();
        if (timestamp - lastSnapshot < snapshotInterval) return;
        lastSnapshot = timestamp;
        snapshots += 1;
        const page = safeParse(html, true, briefTheme);
        if (!page || page.nodes.length === 0) return;
        // 55 -> 90 as the document grows; the model does not tell us how much
        // is left, so this is a damped estimate, never a regression.
        progress = Math.min(90, Math.max(progress, 55 + snapshots * 3));
        await emitter.emit("rendering", progress, {
          type: "design.page",
          message: "Building the 3D page.",
          page,
          generatedCharacters: html.length,
        });
      },
    });
    throwIfAborted();

    const page = parseDesignPage(result.html, { partial: false, theme: briefTheme });
    if (page.nodes.length === 0) {
      throw new DesignOutputError("The generated page contained no renderable content.");
    }

    await emitter.emit("completed", 100, {
      type: "workflow.completed",
      status: "completed",
      message: "The 3D page is ready.",
      model: result.model,
      responseId: result.responseId,
      usage: result.usage,
      page,
    });

    return {
      jobId,
      brief,
      page,
      html: result.html,
      model: result.model,
      responseId: result.responseId,
    };
  } catch (error) {
    const aborted = options.signal?.aborted;
    const failure = classifyFailure(aborted ? new DesignAbortedError() : error);
    try {
      await emitter.emit("failed", progress, {
        type: "workflow.failed",
        status: "failed",
        message: failure.message,
        error: { code: failure.code, retryable: failure.retryable },
      });
    } catch {
      // Keep the original failure if the event transport is already gone.
    }
    throw aborted ? new DesignAbortedError(undefined, { cause: error }) : error;
  }
}

export class DesignOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DesignOutputError";
  }
}

function safeParse(
  html: string,
  partial: boolean,
  theme: Partial<DesignTheme>,
): DesignPage | null {
  try {
    return parseDesignPage(html, { partial, theme });
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Stylesheets and images                                                     */
/* -------------------------------------------------------------------------- */

async function collectStylesheets(
  source: WebpageSource,
  options: DesignWebpageOptions,
): Promise<string[]> {
  const hrefs = extractStylesheetHrefs(source.rawHtml, source.finalUrl).slice(
    0,
    MAX_STYLESHEETS,
  );
  const inline = extractInlineStyles(source.rawHtml);

  const fetched = await Promise.all(
    hrefs.map(async (href) => {
      try {
        const resource = await fetchBinaryResource(href, {
          allowPrivateNetwork: options.allowPrivateNetwork,
          maxBytes: MAX_STYLESHEET_BYTES,
          fetchImpl: options.fetchImpl,
        });
        return new TextDecoder().decode(resource.data);
      } catch {
        return "";
      }
    }),
  );

  return [...inline, ...fetched].filter((value) => value.trim().length > 0);
}

function extractStylesheetHrefs(html: string, baseUrl: string): string[] {
  const hrefs: string[] = [];
  const linkPattern = /<link\b[^>]*>/gi;

  for (const match of html.matchAll(linkPattern)) {
    const tag = match[0];
    if (!/rel\s*=\s*["']?[^"'>]*stylesheet/i.test(tag)) continue;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) continue;
    try {
      const url = new URL(href, baseUrl);
      if (url.protocol === "http:" || url.protocol === "https:") hrefs.push(url.href);
    } catch {
      // Ignore malformed hrefs.
    }
  }

  return hrefs;
}

function extractInlineStyles(html: string): string[] {
  return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1] ?? "")
    .slice(0, 8);
}

/**
 * Downloads the images the page actually shows, in parallel, and returns a map
 * from the raw `src` (and its resolved URL) to a local `/api/assets/...` URL.
 */
async function cacheBriefImages(
  source: WebpageSource,
  store: ImageAssetStore,
  options: DesignWebpageOptions,
): Promise<Map<string, DesignBriefImage>> {
  const references = extractImageReferences(source.rawHtml).slice(0, MAX_BRIEF_IMAGES);
  const entries = new Map<string, DesignBriefImage>();

  await Promise.all(
    references.map(async (reference) => {
      const resolved = resolveUrl(reference.src, source.finalUrl);
      if (!resolved) return;
      try {
        const cached = await store.findBySourceUrl(resolved);
        const asset =
          cached ??
          (await (async () => {
            const resource = await fetchBinaryResource(resolved, {
              allowPrivateNetwork: options.allowPrivateNetwork,
              maxBytes: 8_000_000,
              fetchImpl: options.fetchImpl,
            });
            if (!resource.contentType.startsWith("image/")) return undefined;
            return store.put(resolved, resource.contentType, resource.data);
          })());
        if (!asset) return;

        const image: DesignBriefImage = {
          src: `/api/assets/${asset.id}`,
          alt: reference.alt,
          role: "content",
        };
        entries.set(normalizeImageKey(reference.src, source.finalUrl), image);
        entries.set(resolved, image);
      } catch {
        // A missing image must never fail the conversion.
      }
    }),
  );

  return entries;
}

function extractImageReferences(html: string): { src: string; alt: string }[] {
  const references: { src: string; alt: string }[] = [];
  const seen = new Set<string>();

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const src =
      /(?:^|\s)src\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ??
      /(?:^|\s)data-src\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!src || src.startsWith("data:") || seen.has(src)) continue;
    seen.add(src);
    const alt = /alt\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? "";
    references.push({ src, alt: alt.replace(/\s+/g, " ").trim() });
  }

  return references;
}

function normalizeImageKey(rawSrc: string, baseUrl: string): string {
  return resolveUrl(rawSrc, baseUrl) ?? rawSrc;
}

function resolveUrl(value: string, baseUrl: string): string | undefined {
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function classifyFailure(error: unknown): {
  code: string;
  message: string;
  retryable: boolean;
} {
  if (error instanceof DesignAbortedError) {
    return {
      code: "WORKFLOW_ABORTED",
      message: "The conversion was cancelled.",
      retryable: true,
    };
  }
  if (error instanceof WebpageSourceError) {
    return {
      code: "SOURCE_FETCH_FAILED",
      message: "The page could not be collected.",
      retryable: false,
    };
  }
  if (error instanceof GrokConfigurationError) {
    return {
      code: "MODEL_NOT_CONFIGURED",
      message: "The design model is not configured.",
      retryable: false,
    };
  }
  if (error instanceof DesignOutputError) {
    return {
      code: "INVALID_DESIGN",
      message: "The generated page could not be rendered.",
      retryable: true,
    };
  }
  if (error instanceof GrokApiError) {
    return {
      code: "MODEL_REQUEST_FAILED",
      message: "The design request failed.",
      retryable: error.status === 429 || error.status >= 500,
    };
  }
  return {
    code: "WORKFLOW_FAILED",
    message: "The conversion failed.",
    retryable: true,
  };
}
