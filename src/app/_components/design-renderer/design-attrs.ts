/**
 * DOM-free helpers for the design renderer: HTML/SVG attribute-name mapping,
 * inline-style conversion, and value sanitizers.
 *
 * Everything here is pure so it can be unit tested with `node:test` without a
 * DOM. The renderer only wires these results into React elements.
 */

import type { CSSProperties } from "react";

/* -------------------------------------------------------------------------- */
/* Attribute names                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Lookup key for an attribute name: lower-cased with dashes removed. Grok
 * writes HTML and an HTML parser lower-cases attribute names, so `viewBox`
 * arrives as `viewbox` and `strokeWidth` as `strokewidth`. Squashing the kebab
 * and camel spellings onto one key means `stroke-width`, `strokewidth`, and
 * `strokeWidth` all resolve to the same React prop.
 */
function attrKey(name: string): string {
  return name.toLowerCase().replace(/-/g, "");
}

/** Squashed attribute name -> React prop name. */
const ATTRIBUTE_NAME_MAP: Readonly<Record<string, string>> = {
  // HTML
  class: "className",
  classname: "className",
  for: "htmlFor",
  htmlfor: "htmlFor",
  colspan: "colSpan",
  rowspan: "rowSpan",
  srcset: "srcSet",
  usemap: "useMap",
  maxlength: "maxLength",
  minlength: "minLength",
  readonly: "readOnly",
  tabindex: "tabIndex",
  accesskey: "accessKey",
  autocomplete: "autoComplete",
  autofocus: "autoFocus",
  autoplay: "autoPlay",
  novalidate: "noValidate",
  formaction: "formAction",
  formmethod: "formMethod",
  formtarget: "formTarget",
  enctype: "encType",
  acceptcharset: "acceptCharset",
  contenteditable: "contentEditable",
  spellcheck: "spellCheck",
  crossorigin: "crossOrigin",
  datetime: "dateTime",
  cellpadding: "cellPadding",
  cellspacing: "cellSpacing",
  inputmode: "inputMode",
  referrerpolicy: "referrerPolicy",
  srclang: "srcLang",
  itemprop: "itemProp",
  itemscope: "itemScope",
  itemtype: "itemType",
  // SVG presentation + geometry
  viewbox: "viewBox",
  preserveaspectratio: "preserveAspectRatio",
  strokewidth: "strokeWidth",
  strokelinecap: "strokeLinecap",
  strokelinejoin: "strokeLinejoin",
  strokedasharray: "strokeDasharray",
  strokedashoffset: "strokeDashoffset",
  strokeopacity: "strokeOpacity",
  strokemiterlimit: "strokeMiterlimit",
  fillopacity: "fillOpacity",
  fillrule: "fillRule",
  clippath: "clipPath",
  cliprule: "clipRule",
  clippathunits: "clipPathUnits",
  stopcolor: "stopColor",
  stopopacity: "stopOpacity",
  fontfamily: "fontFamily",
  fontsize: "fontSize",
  fontweight: "fontWeight",
  fontstyle: "fontStyle",
  textanchor: "textAnchor",
  dominantbaseline: "dominantBaseline",
  alignmentbaseline: "alignmentBaseline",
  vectoreffect: "vectorEffect",
  shaperendering: "shapeRendering",
  paintorder: "paintOrder",
  markerstart: "markerStart",
  markermid: "markerMid",
  markerend: "markerEnd",
  gradientunits: "gradientUnits",
  gradienttransform: "gradientTransform",
  patternunits: "patternUnits",
  maskunits: "maskUnits",
};

/** React prop names whose value must be a boolean, not a string. */
const BOOLEAN_PROPS: ReadonlySet<string> = new Set([
  "disabled",
  "required",
  "readOnly",
  "multiple",
  "hidden",
  "autoFocus",
  "autoPlay",
  "noValidate",
  "checked",
  "defaultChecked",
  "controls",
  "loop",
  "muted",
  "open",
  "reversed",
  "itemScope",
]);

/** Attributes that carry a URL and therefore need scheme checking. */
const URL_PROPS: ReadonlySet<string> = new Set([
  "href",
  "src",
  "action",
  "formAction",
  "poster",
]);

/** Never forwarded, whatever the tag. */
const DROPPED_KEYS: ReadonlySet<string> = new Set([
  "style", // comes from `node.style`, not `node.attrs`
  "key",
  "ref",
  "dangerouslysetinnerhtml",
  "is",
  "slot",
  "xmlns", // React infers the SVG namespace itself
  "srcdoc",
]);

const VALID_ATTRIBUTE_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

export type DesignElementProps = Record<string, string | number | boolean>;

/**
 * Maps a design node's `attrs` bag onto React props.
 *
 * - `aria-*` and `data-*` pass through untouched.
 * - Namespaced (`xlink:href`) and event (`onclick`) attributes are dropped.
 * - URL-bearing attributes are scheme-checked; anything that is not http(s), a
 *   site-relative path, a fragment, or a `data:image/...` URL is dropped.
 * - On form controls `value`/`checked` become `defaultValue`/`defaultChecked`
 *   so the control stays uncontrolled.
 */
export function mapAttributes(
  attrs: Readonly<Record<string, string>> | undefined,
  tag: string,
): DesignElementProps {
  const props: DesignElementProps = {};
  if (!attrs || typeof attrs !== "object") return props;

  const isFormControl =
    tag === "input" || tag === "textarea" || tag === "select";

  for (const [rawName, rawValue] of Object.entries(attrs)) {
    if (typeof rawName !== "string" || typeof rawValue !== "string") continue;
    const name = rawName.trim();
    if (!name) continue;

    const lower = name.toLowerCase();
    if (lower.startsWith("on")) continue; // no inline handlers, ever
    if (name.includes(":")) continue; // xlink:href, xml:lang, ...
    if (DROPPED_KEYS.has(attrKey(name))) continue;

    if (lower.startsWith("aria-") || lower.startsWith("data-")) {
      if (!VALID_ATTRIBUTE_NAME.test(lower)) continue;
      props[lower] = rawValue;
      continue;
    }

    if (!VALID_ATTRIBUTE_NAME.test(name)) continue;

    let prop = ATTRIBUTE_NAME_MAP[attrKey(name)] ?? lower;
    if (isFormControl && prop === "value") prop = "defaultValue";
    if (isFormControl && prop === "checked") prop = "defaultChecked";

    if (prop === "srcSet") {
      const srcSet = safeSrcSet(rawValue);
      if (srcSet === null) continue;
      props[prop] = srcSet;
      continue;
    }

    if (URL_PROPS.has(prop)) {
      const url = safeUrl(rawValue);
      if (url === null) continue;
      props[prop] = url;
      continue;
    }

    props[prop] = BOOLEAN_PROPS.has(prop)
      ? rawValue.trim().toLowerCase() !== "false"
      : rawValue;
  }

  return props;
}

/* -------------------------------------------------------------------------- */
/* URLs                                                                        */
/* -------------------------------------------------------------------------- */

const ABSOLUTE_HTTP = /^https?:\/\/\S+$/i;
const DATA_IMAGE = /^data:image\/(png|jpeg|jpg|gif|webp|avif|svg\+xml);/i;
/** C0 controls, space, and DEL. Browsers strip these from URLs. */
const URL_NOISE = /[\u0000-\u0020\u007f]/g;

/** True for `http://...` / `https://...` only. */
export function isAbsoluteHttpUrl(value: unknown): value is string {
  return typeof value === "string" && ABSOLUTE_HTTP.test(value.trim());
}

/**
 * Returns a URL that is safe to place in the DOM, or `null`. Allows absolute
 * http(s), site-relative paths (`/api/assets/...`), fragments, and inline
 * image data URLs. Everything else — `javascript:`, `vbscript:`, `file:`,
 * protocol-relative `//host` — is rejected. Whitespace and control characters
 * are stripped first, because they are the classic way to hide a scheme.
 */
export function safeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(URL_NOISE, "");
  if (!cleaned) return null;
  if (ABSOLUTE_HTTP.test(cleaned)) return cleaned;
  if (DATA_IMAGE.test(cleaned)) return cleaned;
  if (cleaned.startsWith("#")) return cleaned;
  if (cleaned.startsWith("/") && !cleaned.startsWith("//")) return cleaned;
  return null;
}

/**
 * Validates every candidate in a `srcset` list. If any candidate is unsafe the
 * whole list is dropped, so a bad entry cannot ride along with a good one.
 */
export function safeSrcSet(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const out: string[] = [];
  for (const candidate of value.split(",")) {
    const parts = candidate.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;
    const url = safeUrl(parts[0]);
    if (url === null) return null;
    const descriptor = parts[1];
    out.push(
      descriptor && /^\d+(\.\d+)?[wx]$/.test(descriptor)
        ? `${url} ${descriptor}`
        : url,
    );
  }
  return out.length > 0 ? out.join(", ") : null;
}

/* -------------------------------------------------------------------------- */
/* Inline styles                                                               */
/* -------------------------------------------------------------------------- */

const UNSAFE_STYLE_VALUE = /javascript:|expression\s*\(|[<>{};]/i;

/**
 * Converts a sanitized `Record<string, string>` style bag into a React style
 * object. Custom properties (`--x`) keep their name; everything else is
 * camel-cased with the usual vendor-prefix rules (`-webkit-` -> `Webkit`,
 * `-ms-` -> `ms`).
 */
export function styleToReactStyle(
  style: Readonly<Record<string, string>> | undefined,
): CSSProperties | undefined {
  if (!style || typeof style !== "object") return undefined;
  const out: Record<string, string> = {};
  let count = 0;

  for (const [rawName, rawValue] of Object.entries(style)) {
    if (typeof rawName !== "string" || typeof rawValue !== "string") continue;
    const name = rawName.trim();
    const value = rawValue.trim();
    if (!name || !value) continue;
    if (UNSAFE_STYLE_VALUE.test(value)) continue;

    if (name.startsWith("--")) {
      if (!/^--[A-Za-z0-9_-]+$/.test(name)) continue;
      out[name] = value;
      count += 1;
      continue;
    }

    if (!/^-?[A-Za-z][A-Za-z0-9-]*$/.test(name)) continue;
    out[cssPropertyToReactKey(name)] = value;
    count += 1;
  }

  return count > 0 ? (out as CSSProperties) : undefined;
}

/** `background-color` -> `backgroundColor`, `-webkit-mask` -> `WebkitMask`. */
export function cssPropertyToReactKey(name: string): string {
  const lower = name.toLowerCase();
  if (lower.startsWith("-ms-")) {
    // React's one exception: the Microsoft prefix stays lower-case.
    return `ms${camelize(lower.slice(4), true)}`;
  }
  if (lower.startsWith("-")) {
    return camelize(lower.slice(1), true);
  }
  return camelize(lower, false);
}

function camelize(value: string, upperFirst: boolean): string {
  const camel = value.replace(/-([a-z0-9])/g, (_match, char: string) =>
    char.toUpperCase(),
  );
  return upperFirst ? camel.charAt(0).toUpperCase() + camel.slice(1) : camel;
}

/* -------------------------------------------------------------------------- */
/* `deep-*` attribute reading                                                  */
/* -------------------------------------------------------------------------- */

export type DeepAttrs = ReadonlyMap<string, string>;

/**
 * Normalizes a `deep-*` element's attributes for lookup. Keys are lower-cased
 * with dashes removed, so the model may write `font-family`, `fontfamily`, or
 * `fontFamily` and the renderer reads one canonical `fontfamily`.
 */
export function readDeepAttrs(
  attrs: Readonly<Record<string, string>> | undefined,
): DeepAttrs {
  const map = new Map<string, string>();
  if (!attrs || typeof attrs !== "object") return map;
  for (const [name, value] of Object.entries(attrs)) {
    if (typeof name !== "string" || typeof value !== "string") continue;
    const key = attrKey(name.trim());
    if (!key || map.has(key)) continue;
    map.set(key, value);
  }
  return map;
}

export function attrString(attrs: DeepAttrs, key: string): string | undefined {
  const value = attrs.get(key);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function attrNumber(
  attrs: DeepAttrs,
  key: string,
  options: { min?: number; max?: number } = {},
): number | undefined {
  const raw = attrString(attrs, key);
  if (raw === undefined) return undefined;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return undefined;
  const { min, max } = options;
  if (min !== undefined && parsed < min) return min;
  if (max !== undefined && parsed > max) return max;
  return parsed;
}

/** `spin="false"` is how a default-true flag is turned off. */
export function attrFlag(
  attrs: DeepAttrs,
  key: string,
  fallback: boolean,
): boolean {
  const raw = attrString(attrs, key);
  if (raw === undefined) return fallback;
  const lower = raw.toLowerCase();
  if (lower === "false" || lower === "0" || lower === "no") return false;
  if (lower === "true" || lower === "1" || lower === "yes" || lower === key) {
    return true;
  }
  return fallback;
}

/* -------------------------------------------------------------------------- */
/* Value sanitizers                                                            */
/* -------------------------------------------------------------------------- */

const COLOR_ALLOWED = /^[A-Za-z0-9#%,.()\-_\s/]+$/;
const VALUE_BANNED = /url\(|javascript:|expression\s*\(|@import/i;

/** Accepts hex, rgb/hsl/color-mix functions, `var(--x)`, and named colours. */
export function safeCssColor(
  value: unknown,
  fallback?: string,
): string | undefined {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120) return fallback;
  if (!COLOR_ALLOWED.test(trimmed) || VALUE_BANNED.test(trimmed)) {
    return fallback;
  }
  if (unbalancedParens(trimmed)) return fallback;
  return trimmed;
}

const FONT_ALLOWED = /^[A-Za-z0-9'",.()\-_\s]+$/;

export function safeFontFamily(
  value: unknown,
  fallback?: string,
): string | undefined {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200) return fallback;
  if (!FONT_ALLOWED.test(trimmed) || VALUE_BANNED.test(trimmed)) {
    return fallback;
  }
  if (unbalancedParens(trimmed)) return fallback;
  return trimmed;
}

function unbalancedParens(value: string): boolean {
  let depth = 0;
  for (const char of value) {
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    if (depth < 0) return true;
  }
  return depth !== 0;
}

const CSS_LENGTH = /^-?\d+(\.\d+)?(px|rem|em|vh|vw|vmin|vmax|%|ch)$/;

/** `"520"` -> `"520px"`, `"60vh"` -> `"60vh"`, anything odd -> fallback. */
export function cssLength(value: string | undefined, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return `${trimmed}px`;
  if (CSS_LENGTH.test(trimmed)) return trimmed;
  return fallback;
}

/** Collapses whitespace and truncates, for carousel face labels. */
export function truncateLabel(value: string, max: number): string {
  const trimmed = String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}
