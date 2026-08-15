/**
 * The wire format for a generated 3D page.
 *
 * Grok designs the page as an HTML document. The backend parses that document
 * into this validated, allow-listed tree — never a raw HTML string — and the
 * frontend renders it with React. Plain tags become plain elements; `deep-*`
 * tags become the real 3DUI components from `src/app/3DUI/_lib/`, so the
 * library stays part of the output instead of being replaced by generated CSS.
 */

export const DESIGN_TREE_VERSION = "1.0" as const;

/** Standard HTML tags the generated page may use. */
export const ALLOWED_HTML_TAGS = [
  "div",
  "span",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "nav",
  "aside",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "a",
  "ul",
  "ol",
  "li",
  "figure",
  "figcaption",
  "blockquote",
  "pre",
  "code",
  "em",
  "strong",
  "small",
  "hr",
  "br",
  "img",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "label",
  "input",
  "textarea",
  "button",
  "form",
  "svg",
  "path",
  "circle",
  "rect",
  "line",
  "polyline",
  "polygon",
  "g",
] as const;

/** 3DUI primitives the generated page may place, written as `deep-*` tags. */
export const DEEP_COMPONENT_TAGS = [
  "deep-carousel",
  "deep-carousel-item",
  "deep-button",
  "deep-button-group",
  "deep-card",
  "deep-image",
  "deep-text",
  "deep-text-shadow",
  "deep-icon",
  "deep-chrome",
] as const;

export type AllowedHtmlTag = (typeof ALLOWED_HTML_TAGS)[number];
export type DeepComponentTag = (typeof DEEP_COMPONENT_TAGS)[number];
export type DesignTag = AllowedHtmlTag | DeepComponentTag;

export interface DesignElementNode {
  type: "element";
  /** Stable, generated id used for streaming upserts and highlighting. */
  id: string;
  tag: DesignTag;
  /** Allow-listed attributes (href, alt, type, aria-*, and `deep-*` props). */
  attrs: Record<string, string>;
  /** Sanitized inline style declarations (safe property/value pairs only). */
  style?: Record<string, string>;
  children: DesignNode[];
}

export interface DesignTextNode {
  type: "text";
  value: string;
}

export type DesignNode = DesignElementNode | DesignTextNode;

/**
 * The palette and type the page was designed around, taken from the source
 * site. The renderer uses it to theme 3DUI primitives, which otherwise fall
 * back to their light-grey library defaults and clash with a dark page.
 */
export interface DesignTheme {
  background: string;
  ink: string;
  accent: string;
  surface: string;
  fontFamily: string;
  /** True when `background` is dark; drives contrast choices in the renderer. */
  dark: boolean;
}

export interface DesignPage {
  version: typeof DESIGN_TREE_VERSION;
  title: string;
  theme: DesignTheme;
  /** Sanitized CSS from the document's <style> blocks, scoped at render time. */
  css: string;
  /** Body-level nodes. */
  nodes: DesignNode[];
  /** True while the model is still streaming and the tree is incomplete. */
  partial: boolean;
  stats: {
    elements: number;
    components: Record<string, number>;
    /** Bytes of generated HTML the tree came from. */
    htmlBytes: number;
  };
}
