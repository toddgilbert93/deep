"use client";

import {
  Fragment,
  createElement,
  useMemo,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { Button3D, Button3DGroup } from "@/app/3DUI/_lib/button/Button3D";
import { Card3D } from "@/app/3DUI/_lib/card/Card3D";
import { Carousel3D } from "@/app/3DUI/_lib/carousel/Carousel3D";
import { Chrome3D } from "@/app/3DUI/_lib/chrome/Chrome3D";
import {
  ICON3D_NAMES,
  Icon3D,
  type Icon3DName,
} from "@/app/3DUI/_lib/icon/Icon3D";
import { Image3D } from "@/app/3DUI/_lib/image/Image3D";
import { Text3D } from "@/app/3DUI/_lib/text-extrude/Text3D";
import { TextShadow3D } from "@/app/3DUI/_lib/text-shadow/TextShadow3D";
import type {
  DesignElementNode,
  DesignNode,
  DesignPage,
} from "@/lib/reconstruction/design-tree";
import { DesignErrorBoundary } from "./DesignErrorBoundary";
import {
  attrFlag,
  attrNumber,
  attrString,
  cssLength,
  isAbsoluteHttpUrl,
  mapAttributes,
  readDeepAttrs,
  safeCssColor,
  safeFontFamily,
  safeUrl,
  styleToReactStyle,
  truncateLabel,
  type DeepAttrs,
} from "./design-attrs";
import {
  VOID_TAG_SET,
  isAllowedHtmlTag,
  isDeepTag,
} from "./design-tags";
import { scopeCss } from "./scope-css";
import styles from "./design-renderer.module.css";

/* -------------------------------------------------------------------------- */
/* Props                                                                       */
/* -------------------------------------------------------------------------- */

export interface DesignRendererProps {
  /** `null` before the first tree arrives. */
  page: DesignPage | null;
  className?: string;
  /** Element ids to outline while streaming (Phase 3 highlight). */
  highlightIds?: readonly string[];
  highlightColor?: string;
}

export const DESIGN_HIGHLIGHT_COLOR = "#22c55e";

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

const CAROUSEL_MIN_FACES = 3;
const CAROUSEL_MAX_FACES = 8;
const CAROUSEL_LABEL_MAX = 20;
const TEXT_CONTENT_MAX = 400;

const TEXT3D_WRAPPER_TAGS: ReadonlySet<string> = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "span",
]);
const TEXT_SHADOW_WRAPPER_TAGS: ReadonlySet<string> = new Set([
  "p",
  "span",
  "label",
  "li",
]);
const INPUT_TYPES: ReadonlySet<string> = new Set([
  "text",
  "email",
  "url",
  "search",
  "tel",
  "number",
  "password",
  "checkbox",
  "radio",
  "date",
  "time",
  "range",
  "color",
  "hidden",
  "submit",
  "reset",
  "button",
]);
const BUTTON_TYPES: ReadonlySet<string> = new Set(["button", "submit", "reset"]);

/** Props bag handed to `createElement`; values are React props, not just strings. */
type ElementProps = Record<string, unknown>;

interface RenderContext {
  highlighted: ReadonlySet<string>;
}

interface RenderHints {
  /** Index among `deep-button` siblings, used to spread the six rest tilts. */
  buttonIndex: number;
  /** Parent is a `deep-button-group`: the Button3D must stay a direct child. */
  inButtonGroup: boolean;
}

const ROOT_HINTS: RenderHints = { buttonIndex: 0, inButtonGroup: false };

/* -------------------------------------------------------------------------- */
/* Small helpers                                                               */
/* -------------------------------------------------------------------------- */

function classes(
  ...values: Array<string | false | null | undefined>
): string | undefined {
  const joined = values.filter(Boolean).join(" ");
  return joined || undefined;
}

function isElementNode(node: unknown): node is DesignElementNode {
  return (
    typeof node === "object" &&
    node !== null &&
    (node as { type?: unknown }).type === "element" &&
    typeof (node as { tag?: unknown }).tag === "string"
  );
}

function nodeId(node: DesignElementNode, fallback: string): string {
  return typeof node.id === "string" && node.id ? node.id : fallback;
}

function childNodes(node: DesignElementNode): readonly DesignNode[] {
  return Array.isArray(node.children) ? node.children : [];
}

/** Flattened text of a subtree, used where only plain text may be rendered. */
function textContent(node: DesignNode | undefined, budget = TEXT_CONTENT_MAX): string {
  if (!node || typeof node !== "object") return "";
  if (node.type === "text") {
    return typeof node.value === "string" ? node.value.slice(0, budget) : "";
  }
  if (!isElementNode(node)) return "";
  let out = "";
  for (const child of childNodes(node)) {
    if (out.length >= budget) break;
    out += textContent(child, budget - out.length);
  }
  return out;
}

function clampFaceCount(count: number): number {
  return Math.min(
    CAROUSEL_MAX_FACES,
    Math.max(CAROUSEL_MIN_FACES, Math.round(count)),
  );
}

/* -------------------------------------------------------------------------- */
/* Tree walking                                                                */
/* -------------------------------------------------------------------------- */

function renderNodes(
  nodes: readonly DesignNode[] | undefined,
  ctx: RenderContext,
  options: { inButtonGroup?: boolean } = {},
): ReactNode[] {
  if (!Array.isArray(nodes)) return [];
  const out: ReactNode[] = [];
  let buttonIndex = 0;

  nodes.forEach((node, index) => {
    if (!node || typeof node !== "object") return;

    if (node.type === "text") {
      const value = typeof node.value === "string" ? node.value : "";
      if (value) out.push(<Fragment key={`text-${index}`}>{value}</Fragment>);
      return;
    }

    if (!isElementNode(node)) return;

    const hints: RenderHints = {
      buttonIndex: node.tag === "deep-button" ? buttonIndex++ : 0,
      inButtonGroup: options.inButtonGroup === true,
    };
    // Fragments create no DOM node, so `Button3DGroup`'s nth-child tilt rule
    // still sees the buttons as its direct children.
    out.push(
      <Fragment key={nodeId(node, `node-${index}`)}>
        {renderElement(node, ctx, hints)}
      </Fragment>,
    );
  });

  return out;
}

function renderElement(
  node: DesignElementNode,
  ctx: RenderContext,
  hints: RenderHints,
): ReactNode {
  const tag = node.tag;
  if (isDeepTag(tag)) return renderDeepElement(node, tag, ctx, hints);
  if (isAllowedHtmlTag(tag)) return renderHtmlElement(node, tag, ctx);
  // Unknown tag: keep the content, drop the box.
  return <>{renderNodes(childNodes(node), ctx)}</>;
}

/* -------------------------------------------------------------------------- */
/* Plain HTML                                                                  */
/* -------------------------------------------------------------------------- */

function renderHtmlElement(
  node: DesignElementNode,
  tag: string,
  ctx: RenderContext,
): ReactNode {
  const id = nodeId(node, "");
  const mapped = mapAttributes(node.attrs, tag);
  const props: ElementProps = { ...mapped };
  const style = styleToReactStyle(node.style);
  if (style) props.style = style;
  if (id) props["data-design-id"] = id;
  props.className = classes(
    typeof mapped.className === "string" ? mapped.className : undefined,
    id && ctx.highlighted.has(id) ? styles.highlight : undefined,
  );

  const children = renderNodes(childNodes(node), ctx);

  switch (tag) {
    case "a": {
      const href = typeof props.href === "string" ? props.href : undefined;
      if (!href || !isAbsoluteHttpUrl(href)) {
        // Relative or non-http destinations point at pages that do not exist
        // in the reconstruction, so the link becomes inert text.
        delete props.href;
        return createElement("span", props, ...children);
      }
      props.target = "_blank";
      props.rel = "noopener noreferrer";
      return createElement("a", props, ...children);
    }

    case "form": {
      delete props.action;
      delete props.method;
      props.onSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
      };
      return createElement("form", props, ...children);
    }

    case "input": {
      const type =
        typeof props.type === "string" && INPUT_TYPES.has(props.type)
          ? props.type
          : "text";
      props.type = type;
      if (type === "checkbox" || type === "radio") {
        delete props.defaultValue;
      }
      return createElement("input", props);
    }

    case "textarea": {
      // React refuses children on <textarea>; the text becomes the value.
      const fallback = textContent(node);
      if (typeof props.defaultValue !== "string" && fallback) {
        props.defaultValue = fallback;
      }
      if (props.rows === undefined) props.rows = 3;
      return createElement("textarea", props);
    }

    case "button": {
      props.type =
        typeof props.type === "string" && BUTTON_TYPES.has(props.type)
          ? props.type
          : "button";
      return createElement("button", props, ...children);
    }

    case "img": {
      if (typeof props.src !== "string") {
        return (
          <span className={styles.visuallyHidden} data-design-id={id || undefined}>
            Image missing
          </span>
        );
      }
      if (typeof props.alt !== "string") props.alt = "";
      if (props.loading === undefined) props.loading = "lazy";
      if (props.decoding === undefined) props.decoding = "async";
      /* A plain <img>, not next/image: generated pages reference local,
         content-addressed assets served by /api/assets whose dimensions are
         unknown at build time, so the optimizer has nothing to work with. */
      return createElement("img", props);
    }

    default: {
      if (VOID_TAG_SET.has(tag)) return createElement(tag, props);
      return createElement(tag, props, ...children);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* `deep-*` primitives                                                         */
/* -------------------------------------------------------------------------- */

function renderDeepElement(
  node: DesignElementNode,
  tag: string,
  ctx: RenderContext,
  hints: RenderHints,
): ReactNode {
  const attrs = readDeepAttrs(node.attrs);
  const id = nodeId(node, "");
  const style = styleToReactStyle(node.style);
  const highlight = id && ctx.highlighted.has(id) ? styles.highlight : undefined;
  const shell: DeepShell = { id, style, highlight, attrs };

  switch (tag) {
    case "deep-button":
      return renderDeepButton(node, shell, hints);
    case "deep-button-group":
      return renderDeepButtonGroup(node, shell, ctx);
    case "deep-card":
      return renderDeepCard(node, shell, ctx);
    case "deep-carousel":
      return renderDeepCarousel(node, shell, ctx);
    case "deep-carousel-item":
      // Only meaningful inside `deep-carousel`; standalone it is just text.
      return (
        <span
          data-design-id={shell.id || undefined}
          className={classes(styles.inline, shell.highlight)}
          style={shell.style}
        >
          {renderNodes(childNodes(node), ctx)}
        </span>
      );
    case "deep-chrome":
      return renderDeepChrome(node, shell, ctx);
    case "deep-icon":
      return renderDeepIcon(shell);
    case "deep-image":
      return renderDeepImage(shell);
    case "deep-text":
      return renderDeepText(node, shell);
    case "deep-text-shadow":
      return renderDeepTextShadow(node, shell);
    default:
      return <>{renderNodes(childNodes(node), ctx)}</>;
  }
}

/**
 * Button3D has a fixed width, so a long label is clipped. When the design does
 * not specify one, size the button to its text.
 */
function estimateButtonWidth(label: string): number {
  const characters = label.trim().length;
  if (characters === 0) return 160;
  return Math.min(420, Math.max(140, Math.round(characters * 11 + 56)));
}

interface DeepShell {
  id: string;
  style: CSSProperties | undefined;
  highlight: string | undefined;
  attrs: DeepAttrs;
}

function renderDeepButton(
  node: DesignElementNode,
  shell: DeepShell,
  hints: RenderHints,
): ReactNode {
  const { attrs } = shell;
  const label =
    attrString(attrs, "label") ?? truncateLabel(textContent(node), 80);
  const href = safeUrl(attrString(attrs, "href"));
  const explicitTilt = attrNumber(attrs, "tilt");
  const tilt =
    explicitTilt !== undefined
      ? Math.abs(Math.round(explicitTilt)) % 6
      : hints.inButtonGroup
        ? // Inside a group the CSS assigns six rests by nth-child; an inline
          // tilt variable would override it and clone every button.
          undefined
        : hints.buttonIndex % 6;

  const props = {
    width: attrNumber(attrs, "width", { min: 1 }) ?? estimateButtonWidth(label),
    height: attrNumber(attrs, "height", { min: 1 }),
    depth: attrNumber(attrs, "depth", { min: 0 }),
    tilt,
    face: safeCssColor(attrString(attrs, "face")),
    ink: safeCssColor(attrString(attrs, "ink")),
    fontFamily: safeFontFamily(attrString(attrs, "fontfamily")),
    spin: attrFlag(attrs, "spin", true),
    disabled: attrFlag(attrs, "disabled", false),
    // Button3D's default root is a (width + height) square so it has room to
    // rotate, which leaves huge holes in a laid-out page. `nested` shrinks the
    // root to exactly width x height; the perspective it gives up is supplied
    // by the wrapper below (standalone) or by the group (see the module CSS).
    nested: true,
    className: shell.highlight,
    style: shell.style,
    "data-design-id": shell.id || undefined,
    // Never wrap a <button> in an <a>; open the destination instead.
    onClick:
      href && isAbsoluteHttpUrl(href)
        ? () => {
            if (typeof window !== "undefined") {
              window.open(href, "_blank", "noopener,noreferrer");
            }
          }
        : undefined,
  };

  const button = <Button3D {...props}>{label || "Button"}</Button3D>;

  // A grouped button must stay a DIRECT child of Button3DGroup, whose CSS
  // assigns the six rest angles by nth-child; the group supplies perspective
  // instead (see design-renderer.module.css).
  return hints.inButtonGroup ? (
    button
  ) : (
    <span className={styles.buttonSlot}>{button}</span>
  );
}

function renderDeepButtonGroup(
  node: DesignElementNode,
  shell: DeepShell,
  ctx: RenderContext,
): ReactNode {
  const children = childNodes(node);
  const buttons = children.filter(
    (child) => isElementNode(child) && child.tag === "deep-button",
  );
  const others = children.filter(
    (child) => !(isElementNode(child) && child.tag === "deep-button"),
  );

  return (
    <div
      data-design-id={shell.id || undefined}
      className={classes(styles.block, shell.highlight)}
      style={shell.style}
    >
      <Button3DGroup>
        {renderNodes(buttons, ctx, { inButtonGroup: true })}
      </Button3DGroup>
      {others.length > 0 ? renderNodes(others, ctx) : null}
    </div>
  );
}

function renderDeepCard(
  node: DesignElementNode,
  shell: DeepShell,
  ctx: RenderContext,
): ReactNode {
  const { attrs } = shell;
  return (
    <div
      data-design-id={shell.id || undefined}
      className={classes(styles.block, shell.highlight)}
      style={shell.style}
    >
      <Card3D
        width={attrNumber(attrs, "width", { min: 1 })}
        height={attrNumber(attrs, "height", { min: 1 })}
        depth={attrNumber(attrs, "depth", { min: 0 })}
        face={safeCssColor(attrString(attrs, "face"))}
        ink={safeCssColor(attrString(attrs, "ink"))}
        fontFamily={safeFontFamily(attrString(attrs, "fontfamily"))}
      >
        <div className={styles.cardBody}>{renderNodes(childNodes(node), ctx)}</div>
      </Card3D>
    </div>
  );
}

function renderDeepCarousel(
  node: DesignElementNode,
  shell: DeepShell,
  ctx: RenderContext,
): ReactNode {
  const { attrs } = shell;
  const items = childNodes(node).filter(isElementNode);
  const requested = attrNumber(attrs, "count", { min: 1 });
  const faceCount = clampFaceCount(requested ?? items.length ?? 0);
  // The component clamps too, but surplus items would silently vanish, so drop
  // them here and list them after the stage instead.
  const shown = items.slice(0, faceCount);
  const surplus = items.slice(faceCount);

  const faces = shown.map((item, index) => {
    const itemAttrs = readDeepAttrs(item.attrs);
    const label =
      attrString(itemAttrs, "label") ?? truncateLabel(textContent(item), CAROUSEL_LABEL_MAX);
    const itemId = nodeId(item, "");
    return (
      <span
        key={itemId || `face-${index}`}
        data-design-id={itemId || undefined}
        className={
          itemId && ctx.highlighted.has(itemId) ? styles.highlight : undefined
        }
      >
        {label || `Item ${index + 1}`}
      </span>
    );
  });

  return (
    <>
      <div
        data-design-id={shell.id || undefined}
        className={classes(styles.carouselStage, shell.highlight)}
        style={{
          ...shell.style,
          height: cssLength(attrString(attrs, "height"), "360px"),
          width: "100%",
        }}
      >
        <Carousel3D count={faceCount} spin={attrFlag(attrs, "spin", true)}>
          {faces}
        </Carousel3D>
      </div>
      {surplus.length > 0 ? (
        <ul className={styles.carouselOverflow}>
          {surplus.map((item, index) => {
            const itemId = nodeId(item, "");
            return (
              <li key={itemId || `surplus-${index}`} data-design-id={itemId || undefined}>
                {truncateLabel(textContent(item), CAROUSEL_LABEL_MAX) ||
                  `Item ${faceCount + index + 1}`}
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
}

function renderDeepChrome(
  node: DesignElementNode,
  shell: DeepShell,
  ctx: RenderContext,
): ReactNode {
  const { attrs } = shell;
  return (
    <div
      data-design-id={shell.id || undefined}
      className={classes(styles.chromeStage, shell.highlight)}
      style={{
        ...shell.style,
        position: "relative",
        height: cssLength(attrString(attrs, "height"), "360px"),
        width: cssLength(attrString(attrs, "width"), "min(100%, 720px)"),
      }}
    >
      <Chrome3D depth={attrNumber(attrs, "depth", { min: 0 })}>
        <div className={styles.chromeBody}>{renderNodes(childNodes(node), ctx)}</div>
      </Chrome3D>
    </div>
  );
}

function renderDeepIcon(shell: DeepShell): ReactNode {
  const { attrs } = shell;
  const name = attrString(attrs, "name") ?? "";
  const known = (ICON3D_NAMES as readonly string[]).includes(name);

  return (
    <span
      data-design-id={shell.id || undefined}
      className={classes(styles.inline, shell.highlight)}
      style={shell.style}
    >
      {known ? (
        <Icon3D
          name={name as Icon3DName}
          size={attrNumber(attrs, "size", { min: 1 })}
          depth={attrNumber(attrs, "depth", { min: 0 })}
          spin={attrFlag(attrs, "spin", true)}
          face={safeCssColor(attrString(attrs, "face"))}
        />
      ) : (
        // Icon3D throws on an unknown glyph name, so never construct one.
        <span className={styles.visuallyHidden}>
          Unsupported icon {name || "(unnamed)"}
        </span>
      )}
    </span>
  );
}

function renderDeepImage(shell: DeepShell): ReactNode {
  const { attrs } = shell;
  const src = safeUrl(attrString(attrs, "src"));
  const alt = attrString(attrs, "alt") ?? "";

  if (!src) {
    return (
      <span className={styles.visuallyHidden} data-design-id={shell.id || undefined}>
        Image missing{alt ? `: ${alt}` : ""}
      </span>
    );
  }

  const props = {
    width: attrNumber(attrs, "width", { min: 1 }),
    height: attrNumber(attrs, "height", { min: 1 }),
    depth: attrNumber(attrs, "depth", { min: 0 }),
    className: classes(styles.block, shell.highlight),
    style: shell.style,
    "data-design-id": shell.id || undefined,
  };

  return (
    <Image3D {...props}>
      {/* eslint-disable-next-line @next/next/no-img-element -- the source is a
          local, content-addressed asset served by /api/assets, and Image3D
          expects a plain <img> child inside its lit media slot. */}
      <img src={src} alt={alt} loading="lazy" decoding="async" />
    </Image3D>
  );
}

function renderDeepText(node: DesignElementNode, shell: DeepShell): ReactNode {
  const { attrs } = shell;
  // Text3D paints its children 18 times to fake the extrusion, so only short
  // plain text may go in.
  const text = truncateLabel(textContent(node), 120);
  const wrapperTag = attrString(attrs, "as")?.toLowerCase();
  const wrapped = wrapperTag !== undefined && TEXT3D_WRAPPER_TAGS.has(wrapperTag);

  const props = {
    fontSize: attrNumber(attrs, "fontsize", { min: 1 }),
    depth: attrNumber(attrs, "depth", { min: 0 }),
    ink: safeCssColor(attrString(attrs, "ink")),
    fontFamily: safeFontFamily(attrString(attrs, "fontfamily")),
    className: wrapped ? undefined : shell.highlight,
    style: wrapped ? undefined : shell.style,
    "data-design-id": wrapped ? undefined : shell.id || undefined,
  };

  const element = <Text3D {...props}>{text}</Text3D>;
  if (!wrapped) return element;

  return createElement(
    wrapperTag,
    {
      "data-design-id": shell.id || undefined,
      className: classes(styles.block, shell.highlight),
      style: shell.style,
    },
    element,
  );
}

function renderDeepTextShadow(
  node: DesignElementNode,
  shell: DeepShell,
): ReactNode {
  const { attrs } = shell;
  const text = textContent(node);
  const wrapperTag = attrString(attrs, "as")?.toLowerCase();
  const wrapped =
    wrapperTag !== undefined && TEXT_SHADOW_WRAPPER_TAGS.has(wrapperTag);

  const props = {
    fontSize: attrNumber(attrs, "fontsize", { min: 1 }),
    depth: attrNumber(attrs, "depth", { min: 0 }),
    ink: safeCssColor(attrString(attrs, "ink")),
    fontFamily: safeFontFamily(attrString(attrs, "fontfamily")),
    className: wrapped ? undefined : shell.highlight,
    style: wrapped ? undefined : shell.style,
    "data-design-id": wrapped ? undefined : shell.id || undefined,
  };

  const element = <TextShadow3D {...props}>{text}</TextShadow3D>;
  if (!wrapped) return element;

  return createElement(
    wrapperTag,
    {
      "data-design-id": shell.id || undefined,
      className: classes(styles.block, shell.highlight),
      style: shell.style,
    },
    element,
  );
}

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

function DesignTree({
  nodes,
  ctx,
}: {
  nodes: readonly DesignNode[];
  ctx: RenderContext;
}) {
  // Rendering happens inside this child component so that anything thrown by a
  // malformed node is caught by the boundary above it.
  return <>{renderNodes(nodes, ctx, ROOT_HINTS)}</>;
}

/**
 * Renders a validated `DesignPage` with React: plain tags become plain
 * elements, `deep-*` tags become the real 3DUI primitives, and the page's CSS
 * is scoped so it can only style this subtree.
 *
 * The tree is data, never code. No node is ever turned into markup, and the
 * only `dangerouslySetInnerHTML` in the renderer is the scoped `<style>` block.
 */
export function DesignRenderer({
  page,
  className,
  highlightIds,
  highlightColor = DESIGN_HIGHLIGHT_COLOR,
}: DesignRendererProps) {
  const highlighted = useMemo(
    () => new Set(Array.isArray(highlightIds) ? highlightIds : []),
    [highlightIds],
  );
  const scopedCss = useMemo(
    () => scopeCss(typeof page?.css === "string" ? page.css : ""),
    [page],
  );
  const nodes = useMemo(
    () => (Array.isArray(page?.nodes) ? page.nodes : []),
    [page],
  );

  const ctx = useMemo<RenderContext>(() => ({ highlighted }), [highlighted]);

  const theme = page?.theme;
  const accent = safeCssColor(theme?.accent) ?? "#00a8ff";
  const ink = safeCssColor(theme?.ink) ?? "#f4f4f5";
  const background = safeCssColor(theme?.background) ?? "#0a0604";
  const surface = safeCssColor(theme?.surface) ?? "#15161a";
  const font = safeFontFamily(theme?.fontFamily) ?? "var(--font-body, system-ui, sans-serif)";

  // The 3DUI primitives declare `--ui3d-face`/`--ui3d-ink` on their own roots,
  // so an inherited value can never reach them. The module CSS re-declares the
  // variables with a descendant selector (higher specificity), which themes
  // every primitive — including Carousel3D's internal faces, which expose no
  // colour props — while an explicit face/ink attribute still wins because the
  // component writes it inline.
  const rootStyle = {
    "--design-highlight":
      safeCssColor(highlightColor, DESIGN_HIGHLIGHT_COLOR) ??
      DESIGN_HIGHLIGHT_COLOR,
    "--design-accent": accent,
    "--design-ink": ink,
    "--design-bg": background,
    "--design-surface": surface,
    "--design-font": font,
    "--design-on-accent": theme?.dark === false ? "#ffffff" : "#08090c",
    background,
    color: ink,
    fontFamily: font,
  } as CSSProperties;

  const title = typeof page?.title === "string" ? page.title.trim() : "";

  return (
    <div className={classes(styles.gutter, className)}>
      <div
        data-design-root=""
        className={styles.root}
        style={rootStyle}
        role="region"
        aria-label={title ? `Reconstruction of ${title}` : "Reconstructed page"}
        aria-busy={page?.partial === true || undefined}
      >
        {scopedCss ? (
          // The only dangerouslySetInnerHTML in the renderer. The CSS is
          // sanitized by the backend and every selector is re-prefixed by
          // scopeCss, so these rules cannot escape [data-design-root]. It has
          // to be innerHTML because React will not render a <style> child from
          // an expression without escaping it into text.
          <style
            data-design-css=""
            dangerouslySetInnerHTML={{ __html: scopedCss }}
          />
        ) : null}
        <DesignErrorBoundary>
          {page === null || nodes.length === 0 ? (
            <p className={styles.empty} data-design-empty>
              {page === null
                ? "Waiting for the reconstruction to start…"
                : "No design nodes yet."}
            </p>
          ) : (
            <DesignTree nodes={nodes} ctx={ctx} />
          )}
        </DesignErrorBoundary>
      </div>
    </div>
  );
}
