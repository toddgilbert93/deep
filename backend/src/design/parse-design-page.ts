/**
 * Turns generated HTML into a validated `DesignPage` tree.
 *
 * Nothing the model writes is ever handed to the browser as markup. Tags,
 * attributes, style declarations, URLs, and CSS are allow-listed here, and the
 * result is plain data the React renderer walks. Cheerio parses partial
 * documents happily, so this also runs on a half-streamed response to drive the
 * live preview.
 */
import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";

import {
  ALLOWED_HTML_TAGS,
  type DesignTheme,
  DEEP_COMPONENT_TAGS,
  DESIGN_TREE_VERSION,
  type DesignElementNode,
  type DesignNode,
  type DesignPage,
  type DesignTag,
} from "./design-tree";

const ALLOWED_TAGS = new Set<string>([...ALLOWED_HTML_TAGS, ...DEEP_COMPONENT_TAGS]);
const VOID_TAGS = new Set(["img", "br", "hr", "input"]);

/** Tags whose content is dropped entirely, not just unwrapped. */
const DROPPED_SUBTREES = new Set([
  "script",
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
  "base",
  "form-action",
  "noscript",
  "audio",
  "video",
  "canvas",
]);

const GLOBAL_ATTRS = new Set(["id", "title", "role", "lang", "dir"]);

const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "target", "rel"]),
  img: new Set(["src", "alt", "width", "height", "loading", "decoding"]),
  input: new Set(["type", "name", "placeholder", "value", "required", "disabled", "checked"]),
  textarea: new Set(["name", "placeholder", "rows", "cols"]),
  button: new Set(["type", "disabled"]),
  label: new Set(["for"]),
  form: new Set(["action", "method"]),
  td: new Set(["colspan", "rowspan"]),
  th: new Set(["colspan", "rowspan", "scope"]),
  svg: new Set(["viewBox", "viewbox", "width", "height", "fill", "xmlns", "preserveAspectRatio"]),
  path: new Set(["d", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin"]),
  circle: new Set(["cx", "cy", "r", "fill", "stroke", "stroke-width"]),
  rect: new Set(["x", "y", "width", "height", "rx", "ry", "fill", "stroke", "stroke-width"]),
  line: new Set(["x1", "y1", "x2", "y2", "stroke", "stroke-width"]),
  polyline: new Set(["points", "fill", "stroke", "stroke-width"]),
  polygon: new Set(["points", "fill", "stroke", "stroke-width"]),
  g: new Set(["fill", "stroke", "transform"]),
};

/** Props read off `deep-*` tags by the React renderer. */
const DEEP_ATTRS = new Set([
  "label",
  "href",
  "src",
  "alt",
  "as",
  "name",
  "count",
  "spin",
  "tilt",
  "width",
  "height",
  "depth",
  "size",
  "fontsize",
  "fontSize",
  "face",
  "ink",
  "fontfamily",
  "fontFamily",
]);

/** CSS properties that may appear in an inline `style` attribute. */
const STYLE_PROPERTY = /^[a-z-]{2,40}$/;
const UNSAFE_STYLE_VALUE = /url\s*\(|expression\s*\(|javascript:|@import|<|>/i;
const UNSAFE_CSS_AT_RULE = /@import|@charset|@namespace/i;
const CSS_URL = /url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi;

export interface ParseDesignPageOptions {
  /** Marks the tree as still streaming. */
  partial?: boolean;
  /** Palette and type used to theme the 3DUI primitives. */
  theme?: Partial<DesignTheme>;
  /** Absolute-path prefixes image/asset URLs may use. */
  allowedAssetPrefixes?: readonly string[];
  maxElements?: number;
  maxCssBytes?: number;
}

const DEFAULT_ALLOWED_PREFIXES = ["/api/assets/"] as const;
const DEFAULT_MAX_ELEMENTS = 1500;
const DEFAULT_MAX_CSS_BYTES = 120_000;

export function parseDesignPage(
  html: string,
  options: ParseDesignPageOptions = {},
): DesignPage {
  const allowedPrefixes = options.allowedAssetPrefixes ?? DEFAULT_ALLOWED_PREFIXES;
  const maxElements = options.maxElements ?? DEFAULT_MAX_ELEMENTS;
  const $ = cheerio.load(html || "");

  const title = $("title").first().text().trim();
  const css = collectCss($, options.maxCssBytes ?? DEFAULT_MAX_CSS_BYTES, allowedPrefixes);

  const state: ConvertState = {
    counter: 0,
    elements: 0,
    maxElements,
    components: {},
    allowedPrefixes,
  };

  const body = $("body").first();
  const roots = body.length > 0 ? body.children().toArray() : $.root().children().toArray();
  const nodes: DesignNode[] = [];
  for (const root of roots) {
    const converted = convertNode(root as AnyNode, state);
    nodes.push(...converted);
  }

  return {
    version: DESIGN_TREE_VERSION,
    title,
    theme: resolveTheme(options.theme),
    css,
    nodes,
    partial: options.partial ?? false,
    stats: {
      elements: state.elements,
      components: state.components,
      htmlBytes: html.length,
    },
  };
}

export const FALLBACK_THEME: DesignTheme = {
  background: "#0a0604",
  ink: "#e8dcc8",
  accent: "#00a8ff",
  surface: "#12161c",
  fontFamily: "var(--font-body, system-ui, sans-serif)",
  dark: true,
};

function resolveTheme(theme: Partial<DesignTheme> | undefined): DesignTheme {
  const background = theme?.background ?? FALLBACK_THEME.background;
  const dark = theme?.dark ?? isDarkColor(background) ?? FALLBACK_THEME.dark;
  return {
    background,
    ink: theme?.ink ?? (dark ? "#f4f4f5" : "#101014"),
    accent: theme?.accent ?? FALLBACK_THEME.accent,
    surface: theme?.surface ?? (dark ? "#15161a" : "#f2f2f4"),
    fontFamily: theme?.fontFamily ?? FALLBACK_THEME.fontFamily,
    dark,
  };
}

/** Relative luminance test for hex and rgb() colours; undefined when unknown. */
export function isDarkColor(color: string): boolean | undefined {
  const rgb = parseColor(color);
  if (!rgb) return undefined;
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.35;
}

function parseColor(color: string): [number, number, number] | undefined {
  const value = color.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(value)?.[1];
  if (hex) {
    const full =
      hex.length === 3 || hex.length === 4
        ? hex
            .slice(0, 3)
            .split("")
            .map((character) => character + character)
            .join("")
        : hex.slice(0, 6);
    if (full.length !== 6) return undefined;
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ];
  }
  const rgb = /^rgba?\(([^)]+)\)$/.exec(value)?.[1];
  if (rgb) {
    const parts = rgb.split(/[\s,/]+/).filter(Boolean).slice(0, 3).map(Number);
    if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) {
      return [parts[0], parts[1], parts[2]];
    }
  }
  if (value === "black") return [0, 0, 0];
  if (value === "white") return [255, 255, 255];
  return undefined;
}

interface ConvertState {
  counter: number;
  elements: number;
  maxElements: number;
  components: Record<string, number>;
  allowedPrefixes: readonly string[];
}

function convertNode(node: AnyNode, state: ConvertState): DesignNode[] {
  if (node.type === "text") {
    const value = (node as unknown as { data: string }).data ?? "";
    const cleaned = value.replace(/\s+/g, " ");
    return cleaned.trim().length > 0 ? [{ type: "text", value: cleaned }] : [];
  }

  if (node.type !== "tag" && node.type !== "script" && node.type !== "style") {
    return [];
  }

  const element = node as Element;
  const tag = element.tagName?.toLowerCase();
  if (!tag || DROPPED_SUBTREES.has(tag) || tag === "style" || tag === "script") {
    return [];
  }

  const children = (element.children ?? []).flatMap((child) => convertNode(child, state));

  if (!ALLOWED_TAGS.has(tag)) {
    // Unknown wrapper: keep its content rather than losing the copy.
    return children;
  }
  if (state.elements >= state.maxElements) {
    return children;
  }

  state.elements += 1;
  state.counter += 1;
  if (tag.startsWith("deep-")) {
    state.components[tag] = (state.components[tag] ?? 0) + 1;
  }

  const attrs = sanitizeAttributes(tag, element.attribs ?? {}, state.allowedPrefixes);
  const style = sanitizeStyleAttribute(element.attribs?.style);
  const designNode: DesignElementNode = {
    type: "element",
    id: `d${state.counter}`,
    tag: tag as DesignTag,
    attrs,
    children: VOID_TAGS.has(tag) ? [] : children,
  };
  if (style) designNode.style = style;

  return [designNode];
}

function sanitizeAttributes(
  tag: string,
  attribs: Record<string, string>,
  allowedPrefixes: readonly string[],
): Record<string, string> {
  const allowed = TAG_ATTRS[tag];
  const isDeep = tag.startsWith("deep-");
  const output: Record<string, string> = {};

  for (const [rawName, rawValue] of Object.entries(attribs)) {
    const name = rawName.toLowerCase();
    const value = (rawValue ?? "").trim();

    if (name === "style") continue; // handled separately
    if (name.startsWith("on")) continue; // no event handlers, ever
    if (name === "srcdoc" || name === "formaction" || name.startsWith("xlink")) continue;
    if (value.length > 2000) continue;

    const permitted =
      name === "class" ||
      name.startsWith("aria-") ||
      name.startsWith("data-") ||
      GLOBAL_ATTRS.has(name) ||
      allowed?.has(name) ||
      allowed?.has(rawName) ||
      (isDeep && (DEEP_ATTRS.has(name) || DEEP_ATTRS.has(rawName)));
    if (!permitted) continue;

    if (name === "href") {
      const safe = safeLinkUrl(value);
      if (!safe) continue;
      output.href = safe;
      continue;
    }
    if (name === "src") {
      const safe = safeAssetUrl(value, allowedPrefixes);
      if (!safe) continue;
      output.src = safe;
      continue;
    }
    if (/[<>]/.test(value)) continue;

    output[rawName === "viewBox" ? "viewBox" : name] = value;
  }

  return output;
}

function sanitizeStyleAttribute(style: string | undefined): Record<string, string> | undefined {
  if (!style || style.length > 2000) return undefined;
  const output: Record<string, string> = {};

  for (const declaration of style.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator === -1) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();
    if (!property || !value || value.length > 240) continue;
    if (!STYLE_PROPERTY.test(property) && !property.startsWith("--")) continue;
    if (UNSAFE_STYLE_VALUE.test(value)) continue;
    output[property] = value;
  }

  return Object.keys(output).length > 0 ? output : undefined;
}

/** Collects and sanitizes every <style> block into one stylesheet. */
function collectCss(
  $: cheerio.CheerioAPI,
  maxBytes: number,
  allowedPrefixes: readonly string[],
): string {
  const blocks: string[] = [];
  let total = 0;

  for (const element of $("style").toArray()) {
    const raw = $(element).text();
    if (!raw) continue;
    const cleaned = sanitizeCss(raw, allowedPrefixes);
    if (!cleaned) continue;
    total += cleaned.length;
    if (total > maxBytes) {
      blocks.push(cleaned.slice(0, Math.max(0, cleaned.length - (total - maxBytes))));
      break;
    }
    blocks.push(cleaned);
  }

  return blocks.join("\n");
}

export function sanitizeCss(css: string, allowedPrefixes: readonly string[]): string {
  let output = css
    // Strip anything that could close the style context or import remotely.
    .replace(/<\/?\s*style/gi, "")
    .replace(/<!--|-->/g, "")
    .replace(/expression\s*\(/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/behavior\s*:/gi, "");

  output = output.replace(CSS_URL, (match, _quote: string, url: string) => {
    const safe = safeAssetUrl(url.trim(), allowedPrefixes);
    return safe ? `url("${safe}")` : "none";
  });

  if (UNSAFE_CSS_AT_RULE.test(output)) {
    output = output.replace(/@(?:import|charset|namespace)[^;{]*(?:;|\{[^}]*\})/gi, "");
  }

  return output.trim();
}

function safeLinkUrl(value: string): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("#") || value.startsWith("/")) return value.slice(0, 500);
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "mailto:") {
      return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}

function safeAssetUrl(value: string, allowedPrefixes: readonly string[]): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (allowedPrefixes.some((prefix) => trimmed.startsWith(prefix))) {
    return /^[\w\-./?=&%]+$/.test(trimmed) ? trimmed : undefined;
  }
  return undefined;
}
