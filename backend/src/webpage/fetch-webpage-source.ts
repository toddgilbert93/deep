import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

import * as cheerio from "cheerio";

const DEFAULT_MAX_PAGE_BYTES = 2_000_000;
const DEFAULT_MAX_SCRIPT_BYTES = 1_000_000;
const DEFAULT_MAX_SCRIPTS = 20;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

const blockedAddresses = createBlockedAddressList();

type FetchImplementation = typeof fetch;

export interface WebpageSourceOptions {
  allowPrivateNetwork?: boolean;
  fetchImpl?: FetchImplementation;
  maxPageBytes?: number;
  maxScriptBytes?: number;
  maxScripts?: number;
  timeoutMs?: number;
  userAgent?: string;
}

export interface BinaryResourceOptions {
  allowPrivateNetwork?: boolean;
  fetchImpl?: FetchImplementation;
  maxBytes?: number;
  timeoutMs?: number;
  userAgent?: string;
}

export interface BinaryResource {
  requestedUrl: string;
  finalUrl: string;
  contentType: string;
  data: Uint8Array;
}

export interface CollectedScript {
  kind: "inline" | "external";
  type: string;
  async: boolean;
  defer: boolean;
  sourceUrl?: string;
  finalUrl?: string;
  content?: string;
  bytes?: number;
  error?: string;
}

export interface WebpageSource {
  requestedUrl: string;
  finalUrl: string;
  title: string;
  language?: string;
  rawHtml: string;
  domHtml: string;
  visibleText: string;
  elementCount: number;
  scripts: CollectedScript[];
}

export class WebpageSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebpageSourceError";
  }
}

export async function fetchWebpageSource(
  url: string,
  options: WebpageSourceOptions = {},
): Promise<WebpageSource> {
  const settings = normalizeOptions(options);
  const requestedUrl = parseHttpUrl(url);
  const page = await fetchResource(requestedUrl, settings);

  if (!page.response.ok) {
    throw new WebpageSourceError(
      `Page request failed (${page.response.status}) for ${page.finalUrl}.`,
    );
  }

  const contentType = page.response.headers.get("content-type") ?? "";
  if (
    contentType &&
    !contentType.includes("text/html") &&
    !contentType.includes("application/xhtml+xml")
  ) {
    throw new WebpageSourceError(
      `Expected HTML but received ${JSON.stringify(contentType)}.`,
    );
  }

  const rawHtml = await readTextBody(
    page.response,
    settings.maxPageBytes,
    "HTML page",
  );
  const $ = cheerio.load(rawHtml);
  const scriptElements = $("script")
    .toArray()
    .filter((element) => isJavaScriptType($(element).attr("type")))
    .slice(0, settings.maxScripts);

  const scripts = await Promise.all(
    scriptElements.map(async (element): Promise<CollectedScript> => {
      const node = $(element);
      const type = node.attr("type")?.trim() || "text/javascript";
      const source = node.attr("src")?.trim();
      const common = {
        type,
        async: node.is("[async]"),
        defer: node.is("[defer]"),
      };

      if (!source) {
        const content = node.html() ?? "";
        return {
          kind: "inline",
          ...common,
          content,
          bytes: Buffer.byteLength(content),
        };
      }

      let sourceUrl: URL;
      try {
        sourceUrl = new URL(source, page.finalUrl);
      } catch {
        return {
          kind: "external",
          ...common,
          sourceUrl: source,
          error: "Invalid script URL.",
        };
      }

      try {
        const script = await fetchResource(sourceUrl, settings);
        if (!script.response.ok) {
          throw new WebpageSourceError(
            `Script request failed (${script.response.status}).`,
          );
        }
        const content = await readTextBody(
          script.response,
          settings.maxScriptBytes,
          "JavaScript file",
        );
        return {
          kind: "external",
          ...common,
          sourceUrl: sourceUrl.href,
          finalUrl: script.finalUrl,
          content,
          bytes: Buffer.byteLength(content),
        };
      } catch (error) {
        return {
          kind: "external",
          ...common,
          sourceUrl: sourceUrl.href,
          error: getErrorMessage(error),
        };
      }
    }),
  );

  $("script, style, noscript, template").remove();
  const visibleText = $("body")
    .text()
    .replace(/\s+/g, " ")
    .trim();

  return {
    requestedUrl: requestedUrl.href,
    finalUrl: page.finalUrl,
    title: $("title").text().trim(),
    language: $("html").attr("lang")?.trim() || undefined,
    rawHtml,
    domHtml: cheerio.load(rawHtml).html(),
    visibleText,
    elementCount: $("*").length,
    scripts,
  };
}

export async function fetchBinaryResource(
  url: string,
  options: BinaryResourceOptions = {},
): Promise<BinaryResource> {
  const requestedUrl = parseHttpUrl(url);
  const settings = normalizeOptions({
    allowPrivateNetwork: options.allowPrivateNetwork,
    fetchImpl: options.fetchImpl,
    maxPageBytes: options.maxBytes,
    timeoutMs: options.timeoutMs,
    userAgent: options.userAgent,
  });
  const resource = await fetchResource(requestedUrl, settings);
  if (!resource.response.ok) {
    throw new WebpageSourceError(
      `Resource request failed (${resource.response.status}) for ${resource.finalUrl}.`,
    );
  }

  return {
    requestedUrl: requestedUrl.href,
    finalUrl: resource.finalUrl,
    contentType: (resource.response.headers.get("content-type") ?? "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase(),
    data: await readBinaryBody(
      resource.response,
      options.maxBytes ?? DEFAULT_MAX_PAGE_BYTES,
      "Resource",
    ),
  };
}

interface NormalizedOptions {
  allowPrivateNetwork: boolean;
  fetchImpl: FetchImplementation;
  maxPageBytes: number;
  maxScriptBytes: number;
  maxScripts: number;
  timeoutMs: number;
  userAgent: string;
}

function normalizeOptions(options: WebpageSourceOptions): NormalizedOptions {
  return {
    allowPrivateNetwork: options.allowPrivateNetwork ?? false,
    fetchImpl: options.fetchImpl ?? fetch,
    maxPageBytes: options.maxPageBytes ?? DEFAULT_MAX_PAGE_BYTES,
    maxScriptBytes: options.maxScriptBytes ?? DEFAULT_MAX_SCRIPT_BYTES,
    maxScripts: options.maxScripts ?? DEFAULT_MAX_SCRIPTS,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    userAgent:
      options.userAgent ?? "DeepWebpageEvaluator/0.1 (+source-collection)",
  };
}

async function fetchResource(
  initialUrl: URL,
  options: NormalizedOptions,
): Promise<{ response: Response; finalUrl: string }> {
  let currentUrl = initialUrl;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    await assertUrlAllowed(currentUrl, options.allowPrivateNetwork);
    const response = await options.fetchImpl(currentUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/javascript,text/javascript,*/*;q=0.8",
        "User-Agent": options.userAgent,
      },
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs),
    });

    if (!isRedirect(response.status)) {
      return { response, finalUrl: currentUrl.href };
    }

    const location = response.headers.get("location");
    if (!location) {
      throw new WebpageSourceError("Redirect response is missing Location.");
    }

    currentUrl = parseHttpUrl(new URL(location, currentUrl).href);
  }

  throw new WebpageSourceError(`Too many redirects (maximum ${MAX_REDIRECTS}).`);
}

async function assertUrlAllowed(
  url: URL,
  allowPrivateNetwork: boolean,
): Promise<void> {
  if (allowPrivateNetwork) {
    return;
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const literalAddressFamily = isIP(hostname);
  const addresses = literalAddressFamily
    ? [{ address: hostname, family: literalAddressFamily }]
    : await lookup(hostname, { all: true, verbatim: true });

  if (addresses.length === 0) {
    throw new WebpageSourceError(`Could not resolve ${hostname}.`);
  }

  for (const entry of addresses) {
    const type = entry.family === 6 ? "ipv6" : "ipv4";
    if (blockedAddresses.check(entry.address, type)) {
      throw new WebpageSourceError(
        `Private or reserved network address is not allowed: ${hostname}.`,
      );
    }
  }
}

function parseHttpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new WebpageSourceError("A valid absolute URL is required.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WebpageSourceError("Only HTTP and HTTPS URLs are supported.");
  }
  if (url.username || url.password) {
    throw new WebpageSourceError("URLs containing credentials are not allowed.");
  }

  return url;
}

async function readTextBody(
  response: Response,
  maxBytes: number,
  label: string,
): Promise<string> {
  const body = await readBinaryBody(response, maxBytes, label);
  return new TextDecoder().decode(body);
}

async function readBinaryBody(
  response: Response,
  maxBytes: number,
  label: string,
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new WebpageSourceError(`${label} exceeds the ${maxBytes}-byte limit.`);
  }

  if (!response.body) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new WebpageSourceError(`${label} exceeds the ${maxBytes}-byte limit.`);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function isJavaScriptType(type: string | undefined): boolean {
  if (!type?.trim()) {
    return true;
  }

  return [
    "module",
    "text/javascript",
    "application/javascript",
    "text/ecmascript",
    "application/ecmascript",
  ].includes(type.trim().toLowerCase());
}

function isRedirect(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createBlockedAddressList(): BlockList {
  const list = new BlockList();
  const ipv4Ranges: Array<[string, number]> = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
  ];
  for (const [network, prefix] of ipv4Ranges) {
    list.addSubnet(network, prefix, "ipv4");
  }

  // Do not add the IPv4-mapped range (`::ffff:0:0/96`) here. Node's BlockList
  // compares IPv4 addresses through their IPv4-mapped IPv6 form, so that rule
  // blocks every public IPv4 address. IPv4-mapped literals such as
  // `::ffff:127.0.0.1` are already matched by the IPv4 rules above.
  const ipv6Ranges: Array<[string, number]> = [
    ["::", 128],
    ["::1", 128],
    ["fc00::", 7],
    ["fe80::", 10],
    ["ff00::", 8],
    ["2001:db8::", 32],
  ];
  for (const [network, prefix] of ipv6Ranges) {
    list.addSubnet(network, prefix, "ipv6");
  }

  return list;
}
