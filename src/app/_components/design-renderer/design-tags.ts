/**
 * Runtime tag allow-lists for the design renderer.
 *
 * These are declared as `Record<Tag, true>` against the contract's union types,
 * so TypeScript fails the build if the backend adds, removes, or renames a tag
 * and this renderer is not updated. No backend *values* are imported.
 */

import type {
  AllowedHtmlTag,
  DeepComponentTag,
} from "@/lib/reconstruction/design-tree";

const HTML_TAG_TABLE: Record<AllowedHtmlTag, true> = {
  div: true,
  span: true,
  section: true,
  article: true,
  header: true,
  footer: true,
  main: true,
  nav: true,
  aside: true,
  h1: true,
  h2: true,
  h3: true,
  h4: true,
  h5: true,
  h6: true,
  p: true,
  a: true,
  ul: true,
  ol: true,
  li: true,
  figure: true,
  figcaption: true,
  blockquote: true,
  pre: true,
  code: true,
  em: true,
  strong: true,
  small: true,
  hr: true,
  br: true,
  img: true,
  table: true,
  thead: true,
  tbody: true,
  tr: true,
  th: true,
  td: true,
  label: true,
  input: true,
  textarea: true,
  button: true,
  form: true,
  svg: true,
  path: true,
  circle: true,
  rect: true,
  line: true,
  polyline: true,
  polygon: true,
  g: true,
};

const DEEP_TAG_TABLE: Record<DeepComponentTag, true> = {
  "deep-carousel": true,
  "deep-carousel-item": true,
  "deep-button": true,
  "deep-button-group": true,
  "deep-card": true,
  "deep-image": true,
  "deep-text": true,
  "deep-text-shadow": true,
  "deep-icon": true,
  "deep-chrome": true,
};

export const ALLOWED_HTML_TAG_SET: ReadonlySet<string> = new Set(
  Object.keys(HTML_TAG_TABLE),
);

export const DEEP_TAG_SET: ReadonlySet<string> = new Set(
  Object.keys(DEEP_TAG_TABLE),
);

/** Tags that must never be given children. */
export const VOID_TAG_SET: ReadonlySet<string> = new Set([
  "img",
  "br",
  "hr",
  "input",
]);

/** Tags whose children React refuses to render (value goes to a prop). */
export const TEXT_VALUE_TAG_SET: ReadonlySet<string> = new Set(["textarea"]);

export function isAllowedHtmlTag(tag: unknown): tag is AllowedHtmlTag {
  return typeof tag === "string" && ALLOWED_HTML_TAG_SET.has(tag);
}

export function isDeepTag(tag: unknown): tag is DeepComponentTag {
  return typeof tag === "string" && DEEP_TAG_SET.has(tag);
}
