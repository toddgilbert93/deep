/**
 * Compact design brief.
 *
 * The old pipeline sent Grok a 383-element selector graph (~48k tokens) and
 * asked it to map every element onto a primitive. That was slow, expensive, and
 * produced timid output. The brief instead captures what a designer actually
 * needs to rebuild a page: its identity, palette, type, and ordered content
 * blocks with their real text, links, and locally cached images.
 */
import type { CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import * as cheerio from "cheerio";

import type { WebpageSource } from "../webpage/fetch-webpage-source";

export const DESIGN_BRIEF_VERSION = "1.0" as const;

export interface DesignBriefImage {
  /** Local URL served by `/api/assets/{assetId}`; never the remote source. */
  src: string;
  alt: string;
  role: "logo" | "hero" | "content" | "icon";
}

export interface DesignBriefLink {
  label: string;
  href: string;
}

export interface DesignBriefItem {
  heading?: string;
  text?: string;
  image?: DesignBriefImage;
}

export type DesignBlockKind =
  | "nav"
  | "hero"
  | "section"
  | "features"
  | "stats"
  | "cta"
  | "code"
  | "quote"
  | "form"
  | "footer";

export interface DesignBriefBlock {
  kind: DesignBlockKind;
  heading?: string;
  subheading?: string;
  text?: string[];
  links?: DesignBriefLink[];
  buttons?: DesignBriefLink[];
  items?: DesignBriefItem[];
  images?: DesignBriefImage[];
  code?: string;
}

export interface DesignBrief {
  version: typeof DESIGN_BRIEF_VERSION;
  url: string;
  title: string;
  description?: string;
  language?: string;
  palette: {
    background?: string;
    ink?: string;
    accent?: string;
    surface?: string;
    muted?: string;
    /**
     * How much of the palette was recovered from the source CSS. Modern sites
     * built on atomic classes and design-system tokens often yield nothing, and
     * a half-guessed palette is worse than an honest gap: it produced a white
     * hero on a black page. When this is not "extracted", the model is asked to
     * use the brand's real colours instead.
     */
    confidence: "extracted" | "partial" | "unknown";
    /** True when the source ships a dark colour scheme. */
    prefersDark?: boolean;
  };
  fonts: {
    heading?: string;
    body?: string;
    mono?: string;
  };
  blocks: DesignBriefBlock[];
  stats: {
    blocks: number;
    images: number;
    approxTokens: number;
    truncated: boolean;
  };
}

export interface ExtractDesignBriefOptions {
  /** Maps a resolved image URL to a local `/api/assets/...` URL. */
  resolveImage?: (rawSrc: string) => DesignBriefImage | undefined;
  /** Stylesheet text collected alongside the HTML, used for palette and type. */
  stylesheets?: string[];
  maxBlocks?: number;
  maxCharacters?: number;
}

const DEFAULT_MAX_BLOCKS = 24;
const DEFAULT_MAX_CHARACTERS = 14_000;
const MAX_TEXT = 320;
const MAX_LINKS_PER_BLOCK = 10;
const MAX_ITEMS_PER_BLOCK = 8;

export function extractDesignBrief(
  source: WebpageSource,
  options: ExtractDesignBriefOptions = {},
): DesignBrief {
  const $ = cheerio.load(source.rawHtml);
  const maxBlocks = options.maxBlocks ?? DEFAULT_MAX_BLOCKS;
  const maxCharacters = options.maxCharacters ?? DEFAULT_MAX_CHARACTERS;

  $("script, noscript, template, svg, style").remove();

  const palette = extractPalette($, options.stylesheets ?? []);
  const fonts = extractFonts($, options.stylesheets ?? []);
  const blocks: DesignBriefBlock[] = [];

  const header = $("header").first();
  if (header.length > 0) {
    const nav = buildNavBlock($, header, source, options);
    if (nav) blocks.push(nav);
  } else {
    const nav = buildNavBlock($, $("nav").first(), source, options);
    if (nav) blocks.push(nav);
  }

  const main = $("body");
  const hero = buildHeroBlock($, main, source, options);
  if (hero) blocks.push(hero);

  const heroHeading = hero?.heading;
  for (const element of collectSectionElements($, main)) {
    if (blocks.length >= maxBlocks) break;
    const block = buildSectionBlock($, $(element), source, options);
    if (!block || !blockHasContent(block)) continue;
    if (block.heading && block.heading === heroHeading) continue;
    blocks.push(block);
  }

  const footer = $("footer").first();
  if (footer.length > 0 && blocks.length < maxBlocks) {
    const block = buildSectionBlock($, footer, source, options, "footer");
    if (block && blockHasContent(block)) blocks.push(block);
  }

  const deduped = dedupeBlocks(blocks);
  const brief: DesignBrief = {
    version: DESIGN_BRIEF_VERSION,
    url: source.finalUrl,
    title: source.title || $("title").first().text().trim() || source.finalUrl,
    description:
      textOrUndefined($('meta[name="description"]').attr("content")) ??
      textOrUndefined($('meta[property="og:description"]').attr("content")),
    language: source.language,
    palette,
    fonts,
    blocks: deduped,
    stats: {
      blocks: deduped.length,
      images: countImages(deduped),
      approxTokens: 0,
      truncated: false,
    },
  };

  return enforceBudget(brief, maxCharacters);
}

/* -------------------------------------------------------------------------- */
/* Blocks                                                                     */
/* -------------------------------------------------------------------------- */

type Selection = ReturnType<CheerioAPI>;

function buildNavBlock(
  $: CheerioAPI,
  container: Selection,
  source: WebpageSource,
  options: ExtractDesignBriefOptions,
): DesignBriefBlock | null {
  if (!container || container.length === 0) return null;

  const links = collectLinks($, container, source).slice(0, MAX_LINKS_PER_BLOCK);
  const buttons = collectButtons($, container).slice(0, 4);
  const images = collectImages($, container, options, "logo").slice(0, 2);
  if (links.length === 0 && buttons.length === 0 && images.length === 0) {
    return null;
  }

  return {
    kind: "nav",
    links,
    buttons,
    images,
  };
}

function buildHeroBlock(
  $: CheerioAPI,
  main: Selection,
  source: WebpageSource,
  options: ExtractDesignBriefOptions,
): DesignBriefBlock | null {
  const heading = main.find("h1").first();
  if (heading.length === 0) return null;

  const headingText = cleanText(heading.text());
  if (!headingText) return null;

  // The hero is the heading plus the copy and actions that immediately follow.
  const scope = heading.closest("section, header, div").first();
  const container = scope.length > 0 ? scope : main;
  const paragraphs = container
    .find("p")
    .toArray()
    .map((element) => cleanText($(element).text()))
    .filter((value) => value.length > 24)
    .slice(0, 2);
  const buttons = collectButtons($, container).slice(0, 4);
  const links = buttons.length === 0 ? collectLinks($, container, source).slice(0, 3) : [];
  const code = collectCode($, container);
  const images = collectImages($, container, options, "hero").slice(0, 2);

  return {
    kind: "hero",
    heading: headingText,
    subheading: paragraphs[0],
    text: paragraphs.slice(1),
    buttons,
    links,
    code,
    images,
  };
}

function buildSectionBlock(
  $: CheerioAPI,
  container: Selection,
  source: WebpageSource,
  options: ExtractDesignBriefOptions,
  forcedKind?: DesignBlockKind,
): DesignBriefBlock | null {
  if (!container || container.length === 0) return null;

  const heading = cleanText(container.find("h1, h2, h3").first().text());
  const paragraphs = container
    .find("p")
    .toArray()
    .map((element) => cleanText($(element).text()))
    .filter(Boolean)
    .slice(0, 3);
  const items = collectItems($, container, options);
  const links = collectLinks($, container, source).slice(0, MAX_LINKS_PER_BLOCK);
  const buttons = collectButtons($, container).slice(0, 4);
  const images = collectImages($, container, options, "content").slice(0, 4);
  const code = collectCode($, container);

  const kind: DesignBlockKind =
    forcedKind ??
    (items.length >= 2
      ? "features"
      : code
        ? "code"
        : container.find("form").length > 0
          ? "form"
          : buttons.length > 0 && paragraphs.length <= 1
            ? "cta"
            : "section");

  return {
    kind,
    heading: heading || undefined,
    text: paragraphs,
    items,
    links: kind === "features" ? [] : links,
    buttons,
    images: items.length > 0 ? [] : images,
    code,
  };
}

/**
 * Finds the page's content sections.
 *
 * Landmark elements alone are unreliable: many modern sites nest everything in
 * anonymous divs, which yielded three blocks for a page with five headings.
 * Headings are the durable signal, so each h2/h3 anchors a block built from its
 * nearest meaningful container, de-duplicated so a container is used once.
 */
function collectSectionElements($: CheerioAPI, main: Selection): Element[] {
  const containers: Element[] = [];
  const seen = new Set<Element>();

  const push = (element: Element | undefined): void => {
    if (!element || seen.has(element)) return;
    seen.add(element);
    containers.push(element);
  };

  const headings = main
    .find("h2, h3")
    .toArray()
    .filter((heading) => $(heading).parents("nav, header, footer").length === 0)
    .slice(0, 30);

  for (const heading of headings) {
    const node = $(heading);
    // Walk out to the nearest container that carries more than the heading.
    let container = node.parent();
    for (let depth = 0; depth < 4 && container.length > 0; depth += 1) {
      const text = cleanText(container.text());
      const headingText = cleanText(node.text());
      if (text.length > headingText.length + 40) break;
      container = container.parent();
    }
    const element = (container.length > 0 ? container : node.parent()).get(0);
    push(element as Element | undefined);
  }

  for (const element of main.find("main > section, main > article").toArray().slice(0, 20)) {
    push(element as Element);
  }

  return containers.slice(0, 40);
}

/**
 * Pulls card-like items (feature grids, lists) out of a container.
 *
 * Two traps here, both of which produced garbage copy: an ancestor card wraps
 * the whole grid and swallows every child's text, and `.text()` concatenates
 * descendants with no separator, yielding "ReactThe library for web...". So
 * keep only leaf-most candidates and read heading and body from distinct
 * elements.
 */
function collectItems(
  $: CheerioAPI,
  container: Selection,
  options: ExtractDesignBriefOptions,
): DesignBriefItem[] {
  const candidates = container
    .find("li, article, .card, [class*='card']")
    .toArray()
    .filter((element) => {
      // Drop wrappers that contain another candidate; keep the leaves.
      const node = $(element);
      return node.find("li, article, .card, [class*='card']").length === 0;
    });

  const items: DesignBriefItem[] = [];
  const seen = new Set<string>();

  for (const element of candidates) {
    if (items.length >= MAX_ITEMS_PER_BLOCK) break;
    const node = $(element);
    // Card titles are frequently not headings at all: a common shape is two
    // sibling divs, sometimes marked with data-title/data-subtitle. Read the
    // structure rather than assuming semantic tags.
    const parts = node
      .children()
      .toArray()
      .map((child) => cleanText($(child).text()))
      .filter(Boolean);

    let heading = cleanText(
      node.find("h2, h3, h4, h5, strong, b, [data-title]").first().text(),
    );
    if (!heading && parts.length >= 2 && parts[0].length <= 60) {
      heading = parts[0];
    }

    let text =
      cleanText(node.find("p, [data-subtitle]").first().text()) ||
      (parts.length >= 2 ? parts.slice(1).join(" ") : "");
    if (!text) {
      // Single blob: strip the heading prefix that `.text()` glued to the front.
      const whole = cleanText(node.text());
      text = heading && whole.startsWith(heading) ? whole.slice(heading.length).trim() : whole;
    }
    if (heading && text === heading) text = "";

    if (!heading && text.length < 12) continue;
    const key = `${heading}|${text}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const [image] = collectImages($, node, options, "icon");
    items.push({
      heading: heading || undefined,
      text: text ? truncate(text, MAX_TEXT) : undefined,
      image,
    });
  }

  return items;
}

function collectLinks(
  $: CheerioAPI,
  container: Selection,
  source: WebpageSource,
): DesignBriefLink[] {
  const seen = new Set<string>();
  const links: DesignBriefLink[] = [];

  for (const element of container.find("a[href]").toArray()) {
    const node = $(element);
    const label = cleanText(node.text()) || cleanText(node.attr("aria-label") ?? "");
    const rawHref = node.attr("href")?.trim();
    if (!label || !rawHref || label.length > 40) continue;
    const href = absoluteUrl(rawHref, source.finalUrl);
    if (!href) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ label, href });
  }

  return links;
}

function collectButtons($: CheerioAPI, container: Selection): DesignBriefLink[] {
  const seen = new Set<string>();
  const buttons: DesignBriefLink[] = [];

  for (const element of container
    .find("button, [role='button'], a[class*='button'], a[class*='btn'], input[type='submit']")
    .toArray()) {
    const node = $(element);
    const label =
      cleanText(node.text()) ||
      cleanText(node.attr("value") ?? "") ||
      cleanText(node.attr("aria-label") ?? "");
    if (!label || label.length > 40) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    buttons.push({ label, href: node.attr("href")?.trim() ?? "" });
  }

  return buttons;
}

function collectImages(
  $: CheerioAPI,
  container: Selection,
  options: ExtractDesignBriefOptions,
  role: DesignBriefImage["role"],
): DesignBriefImage[] {
  if (!options.resolveImage) return [];
  const images: DesignBriefImage[] = [];
  const seen = new Set<string>();

  for (const element of container.find("img[src], img[data-src]").toArray()) {
    const node = $(element);
    const raw = (node.attr("src") ?? node.attr("data-src") ?? "").trim();
    if (!raw || raw.startsWith("data:")) continue;
    const resolved = options.resolveImage(raw);
    if (!resolved || seen.has(resolved.src)) continue;
    seen.add(resolved.src);
    images.push({
      ...resolved,
      alt: cleanText(node.attr("alt") ?? "") || resolved.alt,
      role,
    });
  }

  return images;
}

function collectCode($: CheerioAPI, container: Selection): string | undefined {
  const code = container.find("pre, code").first();
  if (code.length === 0) return undefined;
  const text = cleanText(code.text());
  return text.length >= 8 ? truncate(text, 200) : undefined;
}

/* -------------------------------------------------------------------------- */
/* Palette and type                                                            */
/* -------------------------------------------------------------------------- */

const COLOR_PATTERN = /#[0-9a-f]{3,8}\b|rgba?\([^)]{3,60}\)|hsla?\([^)]{3,60}\)/gi;

function extractPalette(
  $: CheerioAPI,
  stylesheets: string[],
): DesignBrief["palette"] {
  const allCss = stylesheets.join("\n");
  // Sites that adapt to the OS theme keep their dark values inside a
  // prefers-color-scheme block. Deep renders on a dark canvas with lit 3D
  // surfaces, so when a page defines a dark scheme we design against it —
  // otherwise the light defaults leak through as a white slab on black.
  const darkCss = extractDarkSchemeCss(allCss);
  const css = darkCss ? `${allCss}\n${darkCss}\n${darkCss}` : allCss;
  const palette: DesignBrief["palette"] = { confidence: "unknown" };

  const themeColor = $('meta[name="theme-color"]').attr("content")?.trim();
  const bodyStyle = $("body").attr("style") ?? "";
  const htmlStyle = $("html").attr("style") ?? "";

  palette.background =
    (darkCss ? declarationInRule(darkCss, /^(?:html|body|:root)\b/i, "background-color") : undefined) ??
    (darkCss ? declarationInRule(darkCss, /^(?:html|body|:root)\b/i, "background") : undefined) ??
    firstDeclaration(`${htmlStyle};${bodyStyle}`, "background-color") ??
    firstDeclaration(`${htmlStyle};${bodyStyle}`, "background") ??
    customProperty(css, /--(?:ds-)?(?:color-)?(?:bg|background|background-100|surface-0|page-bg|body-bg)[\w-]*/) ??
    declarationInRule(css, /^(?:html|body|:root)\b/i, "background-color") ??
    declarationInRule(css, /^(?:html|body|:root)\b/i, "background") ??
    themeColor;

  palette.ink =
    (darkCss ? declarationInRule(darkCss, /^(?:html|body|:root)\b/i, "color") : undefined) ??
    firstDeclaration(`${htmlStyle};${bodyStyle}`, "color") ??
    customProperty(css, /--(?:ds-)?(?:color-)?(?:fg|foreground|text|ink|body-color|gray-1000)[\w-]*/) ??
    declarationInRule(css, /^(?:html|body|:root)\b/i, "color");

  palette.accent =
    customProperty(css, /--(?:ds-)?(?:color-)?(?:accent|primary|brand|link|blue-700|blue-600)[\w-]*/) ??
    mostCommonColor(css, [palette.background, palette.ink]);

  palette.surface = customProperty(css, /--(?:color-)?(?:surface|card|panel|elevated)[\w-]*/);
  palette.muted = customProperty(css, /--(?:color-)?(?:muted|secondary|subtle|gray-\d00)[\w-]*/);

  // Only the colour keys are validated; `confidence` and `prefersDark` are not colours.
  for (const key of ["background", "ink", "accent", "surface", "muted"] as const) {
    const value = palette[key];
    if (!value || !isSafeColor(value)) delete palette[key];
  }

  if (!palette.background && darkCss) palette.background = "#0b0b0f";
  if (!palette.ink && palette.background === "#0b0b0f") palette.ink = "#f4f4f5";

  if (darkCss || /color-scheme\s*:\s*[^;}]*dark/i.test(allCss)) {
    palette.prefersDark = true;
  }

  const recovered = [palette.background, palette.ink, palette.accent].filter(Boolean).length;
  palette.confidence = recovered >= 3 ? "extracted" : recovered > 0 ? "partial" : "unknown";

  return palette;
}

/** Concatenates the bodies of every `prefers-color-scheme: dark` block. */
function extractDarkSchemeCss(css: string): string | undefined {
  const blocks: string[] = [];
  const pattern = /@media[^{]*prefers-color-scheme\s*:\s*dark[^{]*\{/gi;

  for (const match of css.matchAll(pattern)) {
    const start = (match.index ?? 0) + match[0].length;
    let depth = 1;
    let index = start;
    while (index < css.length && depth > 0) {
      const character = css[index];
      if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
      index += 1;
    }
    blocks.push(css.slice(start, index - 1));
    if (blocks.length >= 8) break;
  }

  return blocks.length > 0 ? blocks.join("\n") : undefined;
}

function extractFonts($: CheerioAPI, stylesheets: string[]): DesignBrief["fonts"] {
  const css = stylesheets.join("\n");
  const fonts: DesignBrief["fonts"] = {};
  const stacks = [...css.matchAll(/font-family\s*:\s*([^;}]{3,160})/gi)]
    .map((match) => cleanFontStack(match[1]))
    .filter(Boolean) as string[];

  const counts = new Map<string, number>();
  for (const stack of stacks) counts.set(stack, (counts.get(stack) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([stack]) => stack);

  fonts.body = ranked.find((stack) => !/mono/i.test(stack));
  fonts.heading =
    declarationInRule(css, /^h1\b/i, "font-family") ?? fonts.body;
  fonts.mono = ranked.find((stack) => /mono|courier|consolas/i.test(stack));

  const linkedFamilies = $('link[href*="fonts.googleapis.com"]')
    .toArray()
    .flatMap((element) => {
      const href = $(element).attr("href") ?? "";
      return [...href.matchAll(/family=([^&:]+)/g)].map((match) =>
        decodeURIComponent(match[1]).replace(/\+/g, " "),
      );
    });
  if (!fonts.heading && linkedFamilies[0]) fonts.heading = linkedFamilies[0];
  if (!fonts.body && linkedFamilies[0]) fonts.body = linkedFamilies[0];

  for (const key of Object.keys(fonts) as (keyof DesignBrief["fonts"])[]) {
    const value = fonts[key];
    if (!value || value.length > 120 || /[<>{}]/.test(value)) delete fonts[key];
  }

  return fonts;
}

function customProperty(css: string, namePattern: RegExp): string | undefined {
  const pattern = new RegExp(`${namePattern.source}\\s*:\\s*([^;}]{2,60})`, "i");
  const match = pattern.exec(css);
  const value = match?.[1]?.trim();
  return value && isSafeColor(value) ? value : undefined;
}

/** Finds `property` inside the first rule whose selector matches. */
function declarationInRule(
  css: string,
  selectorPattern: RegExp,
  property: string,
): string | undefined {
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (match[1] ?? "").trim();
    if (!selectorPattern.test(selector)) continue;
    const value = firstDeclaration(match[2] ?? "", property);
    if (value) return value;
  }
  return undefined;
}

function firstDeclaration(block: string, property: string): string | undefined {
  const pattern = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]{2,120})`, "i");
  const value = pattern.exec(block)?.[1]?.trim();
  if (!value) return undefined;

  if (property === "font-family") {
    return cleanFontStack(value);
  }
  if (property.startsWith("background")) {
    // `background` is a shorthand: pull the colour out of it.
    const color = COLOR_PATTERN.exec(value)?.[0];
    COLOR_PATTERN.lastIndex = 0;
    return color ?? (isSafeColor(value) ? value : undefined);
  }
  return isSafeColor(value) ? value : undefined;
}

function mostCommonColor(css: string, exclude: (string | undefined)[]): string | undefined {
  const skip = new Set(exclude.filter(Boolean).map((value) => value!.toLowerCase()));
  const counts = new Map<string, number>();
  for (const match of css.matchAll(COLOR_PATTERN)) {
    const color = match[0].toLowerCase();
    if (skip.has(color)) continue;
    if (/^#(fff|ffffff|000|000000)$/.test(color)) continue;
    if (isTranslucent(color)) continue;
    if (isNeutral(color)) continue;
    if (/^(rgba?|hsla?)\([^)]*,\s*0(\.0+)?\s*\)$/.test(color)) continue;
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0];
}

/** Greys carry no brand signal, so they make a poor inferred accent. */
function isNeutral(color: string): boolean {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim())?.[1];
  if (!hex) return false;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return Math.max(r, g, b) - Math.min(r, g, b) < 18;
}

function isSafeColor(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length > 60 || /[<>{};]/.test(trimmed) || /url\(/i.test(trimmed)) return false;
  if (/var\(|calc\(/i.test(trimmed)) return false;
  if (/\(/.test(trimmed) && !/\)$/.test(trimmed)) return false;
  if (isTranslucent(trimmed)) return false;
  return (
    /^#[0-9a-f]{3,8}$/i.test(trimmed) ||
    /^(rgb|rgba|hsl|hsla|color|oklch|lab)\([^)]*\)$/i.test(trimmed) ||
    /^[a-z]{3,20}$/i.test(trimmed)
  );
}

/** Colours with meaningful transparency are shadows and overlays, not brand colours. */
function isTranslucent(value: string): boolean {
  const hex = /^#([0-9a-f]{8}|[0-9a-f]{4})$/i.exec(value.trim())?.[1];
  if (hex) {
    const alpha = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : parseInt(hex[3] + hex[3], 16);
    return alpha < 230;
  }
  const alphaMatch = /^(?:rgba|hsla)\([^)]*[,/]\s*(0?\.\d+|0|1(?:\.0+)?)\s*\)$/i.exec(value.trim());
  if (alphaMatch) return Number(alphaMatch[1]) < 0.9;
  return false;
}

function cleanFontStack(value: string): string | undefined {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed.length > 120) return undefined;
  if (/[<>{}]/.test(trimmed) || /var\(/i.test(trimmed)) return undefined;
  return trimmed;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function blockHasContent(block: DesignBriefBlock): boolean {
  return Boolean(
    block.heading ||
      block.subheading ||
      block.code ||
      (block.text && block.text.length > 0) ||
      (block.items && block.items.length > 0) ||
      (block.links && block.links.length > 0) ||
      (block.buttons && block.buttons.length > 0) ||
      (block.images && block.images.length > 0),
  );
}

function dedupeBlocks(blocks: DesignBriefBlock[]): DesignBriefBlock[] {
  const seen = new Set<string>();
  const output: DesignBriefBlock[] = [];
  for (const block of blocks) {
    const key = JSON.stringify([block.kind, block.heading, block.text?.[0], block.items?.length]);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(pruneEmpty(block));
  }
  return output;
}

function pruneEmpty(block: DesignBriefBlock): DesignBriefBlock {
  const output: DesignBriefBlock = { kind: block.kind };
  if (block.heading) output.heading = block.heading;
  if (block.subheading) output.subheading = block.subheading;
  if (block.text?.length) output.text = block.text;
  if (block.links?.length) output.links = block.links;
  if (block.buttons?.length) output.buttons = block.buttons;
  if (block.items?.length) output.items = block.items;
  if (block.images?.length) output.images = block.images;
  if (block.code) output.code = block.code;
  return output;
}

function countImages(blocks: DesignBriefBlock[]): number {
  return blocks.reduce(
    (total, block) =>
      total +
      (block.images?.length ?? 0) +
      (block.items?.filter((item) => item.image).length ?? 0),
    0,
  );
}

/** Drops trailing blocks until the serialized brief fits the character budget. */
function enforceBudget(brief: DesignBrief, maxCharacters: number): DesignBrief {
  let blocks = brief.blocks;
  let truncated = false;

  while (blocks.length > 1) {
    const size = JSON.stringify({ ...brief, blocks }).length;
    if (size <= maxCharacters) break;
    blocks = blocks.slice(0, -1);
    truncated = true;
  }

  const serialized = JSON.stringify({ ...brief, blocks });
  return {
    ...brief,
    blocks,
    stats: {
      blocks: blocks.length,
      images: countImages(blocks),
      approxTokens: Math.round(serialized.length / 4),
      truncated,
    },
  };
}

function absoluteUrl(value: string, base: string): string | undefined {
  try {
    const url = new URL(value, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

function textOrUndefined(value: string | undefined): string | undefined {
  const cleaned = value ? cleanText(value) : "";
  return cleaned || undefined;
}
