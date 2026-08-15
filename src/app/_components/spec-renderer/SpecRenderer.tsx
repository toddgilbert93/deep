"use client";

import {
  Fragment,
  createElement,
  useCallback,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
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
import {
  RECONSTRUCTION_HIGHLIGHT_COLOR,
  type ReconstructionInteraction,
  type ReconstructionNode,
} from "@/lib/reconstruction/events";
import {
  buildSpecTree,
  layoutToStyle,
  resolveDestination,
  safeCssColor,
  safeFontFamily,
  type SpecTreeNode,
} from "@/lib/reconstruction/spec-tree";
import { defaultAssetUrl, type SpecRendererProps } from "./types";
import styles from "./spec-renderer.module.css";

/* -------------------------------------------------------------------------- */
/* Defaults and allow-lists                                                    */
/* -------------------------------------------------------------------------- */

const DEFAULT_THEME = {
  background: "#0a0604",
  surface: "#0a0604",
  ink: "#e8dcc8",
  accent: "#00a8ff",
  fontFamily: "var(--font-body, var(--font-quantico), sans-serif)",
} as const;

const EMPTY_INTERACTIONS: readonly ReconstructionInteraction[] = [];
const EMPTY_IDS: readonly string[] = [];
const EMPTY_ANNOTATIONS: Readonly<Record<string, string>> = {};

const HTML_TAGS = new Set([
  "div",
  "main",
  "section",
  "nav",
  "header",
  "footer",
  "form",
  "label",
  "input",
  "textarea",
  "select",
  "option",
  "a",
  "p",
  "ul",
  "ol",
  "li",
  "span",
]);
type HtmlTag = Extract<ReconstructionNode, { component: "HtmlElement" }>["props"]["tag"];

const INPUT_TYPES = new Set([
  "text",
  "email",
  "url",
  "password",
  "number",
  "checkbox",
  "radio",
  "submit",
]);
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const TEXT3D_TAGS = new Set([...HEADING_TAGS, "span"]);
const TEXT_SHADOW_TAGS = new Set(["p", "span", "label", "li"]);
const INTERACTIVE_HTML_TAGS = new Set([
  "a",
  "input",
  "textarea",
  "select",
  "option",
  "form",
  "label",
]);
const LABELLED_HTML_TAGS = new Set([
  "nav",
  "section",
  "form",
  "a",
  "input",
  "textarea",
  "select",
  "main",
  "header",
  "footer",
]);
const FIELD_TAGS = new Set(["input", "textarea", "select"]);
const CAROUSEL_LABEL_MAX = 20;

/* -------------------------------------------------------------------------- */
/* Render context and small helpers                                            */
/* -------------------------------------------------------------------------- */

interface RenderContext {
  sourceUrl: string | undefined;
  assetUrl: (assetId: string) => string;
  interactionsBySource: ReadonlyMap<string, readonly ReconstructionInteraction[]>;
  highlighted: ReadonlySet<string>;
  annotations: Readonly<Record<string, string>>;
  isHidden: (id: string) => boolean;
  setHidden: (id: string, next: boolean | ((previous: boolean) => boolean)) => void;
  submittedForms: ReadonlySet<string>;
  markSubmitted: (id: string) => void;
  domId: (id: string) => string;
}

interface RenderHints {
  /** Index among Button3D siblings, used to spread rest tilts. */
  buttonIndex: number;
  /** Parent is a Button3DGroup: the Button3D must be a direct DOM child. */
  inGroup: boolean;
  /** DOM id of the field a `label` node should point at. */
  labelFor?: string;
}

interface OuterAttrs {
  id: string;
  "data-node-id": string;
  "data-node-component": string;
  "data-highlight"?: "true";
  className?: string;
  hidden?: boolean;
  style: CSSProperties;
}

interface NodeBehavior {
  navigateUrl: string | null;
  toggles: { targetId: string; mode: "toggle" | "show" | "hide" }[];
  titles: string[];
}

interface ClickableAttrs {
  onClick?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  role?: "button";
  tabIndex?: number;
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
  title?: string;
}

function classes(...values: Array<string | undefined | false | null>): string | undefined {
  const joined = values.filter(Boolean).join(" ");
  return joined || undefined;
}

function num(value: unknown, minimum = 0): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum
    ? value
    : undefined;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Spec `spin` is a number (degrees); the primitives take a boolean. */
function spinFlag(value: unknown): boolean | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value !== 0;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || "link";
  } catch {
    return "link";
  }
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function hasInteractiveContent(tree: SpecTreeNode): boolean {
  const { node } = tree;
  if (
    node.component === "Button3D" ||
    node.component === "Button3DGroup" ||
    node.component === "Carousel3D"
  ) {
    return true;
  }
  if (node.component === "HtmlElement" && INTERACTIVE_HTML_TAGS.has(str(node.props?.tag))) {
    return true;
  }
  return tree.children.some(hasInteractiveContent);
}

/** Short, text-only label for a node, used on carousel faces. */
function labelOf(tree: SpecTreeNode, index: number): string {
  const { node } = tree;
  let text = "";
  switch (node.component) {
    case "Button3D":
      text = str(node.props?.label);
      break;
    case "Text3D":
    case "TextShadow3D":
      text = str(node.props?.text);
      break;
    case "HtmlElement":
      text = str(node.props?.text) || str(node.props?.ariaLabel);
      break;
    case "Icon3D":
      text = str(node.props?.name);
      break;
    case "Image3D":
      text = str(node.props?.alt);
      break;
    default:
      text = "";
  }
  if (!text.trim()) {
    for (const child of tree.children) {
      const nested = labelOf(child, index);
      if (nested && !/^Item \d+$/.test(nested)) {
        text = nested;
        break;
      }
    }
  }
  const label = truncate(text, CAROUSEL_LABEL_MAX);
  return label || `Item ${index + 1}`;
}

function describeBehavior(nodeId: string, ctx: RenderContext): NodeBehavior {
  const behavior: NodeBehavior = { navigateUrl: null, toggles: [], titles: [] };
  const interactions = ctx.interactionsBySource.get(nodeId);
  if (!interactions) return behavior;

  for (const interaction of interactions) {
    const description = str(interaction.description).trim();
    switch (interaction.action) {
      case "navigate": {
        const url = resolveDestination(interaction.destination, ctx.sourceUrl);
        if (url && !behavior.navigateUrl) {
          behavior.navigateUrl = url;
        } else if (!url && description) {
          behavior.titles.push(description);
        }
        break;
      }
      case "toggle":
      case "show":
      case "hide": {
        if (interaction.targetNodeId) {
          behavior.toggles.push({
            targetId: interaction.targetNodeId,
            mode: interaction.action,
          });
        } else if (description) {
          behavior.titles.push(description);
        }
        break;
      }
      case "submit":
        break;
      default:
        if (description) behavior.titles.push(description);
    }
  }
  return behavior;
}

function activateToggles(behavior: NodeBehavior, ctx: RenderContext): void {
  for (const toggle of behavior.toggles) {
    if (toggle.mode === "toggle") {
      ctx.setHidden(toggle.targetId, (previous) => !previous);
    } else {
      ctx.setHidden(toggle.targetId, toggle.mode === "hide");
    }
  }
}

/**
 * Click/keyboard wiring for toggle-style interactions. `native` elements
 * (buttons, links) only need `onClick`; anything else also gets a button role,
 * a tab stop, and Enter/Space handling.
 */
function clickableAttrs(
  behavior: NodeBehavior,
  ctx: RenderContext,
  native: boolean,
  openNavigateInNewTab = false,
): ClickableAttrs {
  const attrs: ClickableAttrs = {};
  const title = behavior.titles.join(" ");
  if (title) attrs.title = title;

  const hasToggles = behavior.toggles.length > 0;
  const opensUrl = openNavigateInNewTab && Boolean(behavior.navigateUrl);
  if (!hasToggles && !opensUrl) return attrs;

  const activate = () => {
    activateToggles(behavior, ctx);
    if (opensUrl && behavior.navigateUrl && typeof window !== "undefined") {
      window.open(behavior.navigateUrl, "_blank", "noopener,noreferrer");
    }
  };

  attrs.onClick = activate;
  if (hasToggles) {
    const targets = behavior.toggles.map((toggle) => toggle.targetId);
    attrs["aria-controls"] = targets.map(ctx.domId).join(" ");
    if (targets.length === 1) {
      attrs["aria-expanded"] = !ctx.isHidden(targets[0]);
    }
  }
  if (!native) {
    attrs.role = "button";
    attrs.tabIndex = 0;
    attrs.onKeyDown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate();
      }
    };
  }
  return attrs;
}

function outerAttrs(
  node: ReconstructionNode,
  ctx: RenderContext,
  extraStyle?: CSSProperties,
  extraClass?: string,
): OuterAttrs {
  const hidden = ctx.isHidden(node.id);
  const highlighted = ctx.highlighted.has(node.id);
  const annotated = Boolean(ctx.annotations[node.id]);
  const style: CSSProperties = { ...layoutToStyle(node.layout), ...extraStyle };
  if (hidden) style.display = "none";
  if (annotated && !style.position) style.position = "relative";

  const attrs: OuterAttrs = {
    id: ctx.domId(node.id),
    "data-node-id": node.id,
    "data-node-component": str(node.component) || "unknown",
    className: classes(extraClass, highlighted && styles.highlight),
    style,
  };
  if (highlighted) attrs["data-highlight"] = "true";
  if (hidden) attrs.hidden = true;
  return attrs;
}

function annotationFor(nodeId: string, ctx: RenderContext, presentational = false): ReactNode {
  const text = ctx.annotations[nodeId];
  if (typeof text !== "string" || !text.trim()) return null;
  return presentational ? (
    <span className={styles.annotation} data-annotation={nodeId} aria-hidden>
      {text}
    </span>
  ) : (
    <span
      className={styles.annotation}
      data-annotation={nodeId}
      role="status"
      aria-live="polite"
    >
      {text}
    </span>
  );
}

/** For elements that cannot contain the annotation span (fields, lists). */
function annotateOutside(
  nodeId: string,
  ctx: RenderContext,
  element: ReactNode,
  inline: boolean,
): ReactNode {
  const annotation = annotationFor(nodeId, ctx);
  if (!annotation) return element;
  return createElement(
    inline ? "span" : "div",
    { className: inline ? styles.inlineLeaf : undefined, style: { position: "relative" } },
    annotation,
    element,
  );
}

function wrapNavigation(
  tree: SpecTreeNode,
  behavior: NodeBehavior,
  element: ReactNode,
): ReactNode {
  if (!behavior.navigateUrl || hasInteractiveContent(tree)) return element;
  return (
    <a
      href={behavior.navigateUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={styles.blockLink}
      data-node-link={tree.node.id}
    >
      {element}
    </a>
  );
}

/* -------------------------------------------------------------------------- */
/* Tree rendering                                                              */
/* -------------------------------------------------------------------------- */

function renderChildren(
  children: readonly SpecTreeNode[],
  ctx: RenderContext,
  parentComponent?: ReconstructionNode["component"],
): ReactNode[] {
  let buttonIndex = 0;
  return children.map((child, index) => {
    const isButton = child.node.component === "Button3D";
    const hints: RenderHints = {
      buttonIndex: isButton ? buttonIndex++ : 0,
      inGroup: parentComponent === "Button3DGroup" && isButton,
      labelFor: labelTargetFor(children, index, ctx),
    };
    return <Fragment key={child.node.id}>{renderNode(child, ctx, hints)}</Fragment>;
  });
}

function labelTargetFor(
  siblings: readonly SpecTreeNode[],
  index: number,
  ctx: RenderContext,
): string | undefined {
  const current = siblings[index]?.node;
  if (current?.component !== "HtmlElement" || current.props?.tag !== "label") {
    return undefined;
  }
  const next = siblings[index + 1]?.node;
  if (next?.component === "HtmlElement" && FIELD_TAGS.has(str(next.props?.tag))) {
    return ctx.domId(next.id);
  }
  return undefined;
}

function renderNode(tree: SpecTreeNode, ctx: RenderContext, hints: RenderHints): ReactNode {
  const { node } = tree;
  switch (node.component) {
    case "Button3D":
      return renderButton(tree, node, ctx, hints);
    case "Button3DGroup":
      return renderButtonGroup(tree, node, ctx);
    case "Card3D":
      return renderCard(tree, node, ctx);
    case "Carousel3D":
      return renderCarousel(tree, node, ctx);
    case "Chrome3D":
      return renderChrome(tree, node, ctx);
    case "Icon3D":
      return renderIcon(tree, node, ctx);
    case "Image3D":
      return renderImage(tree, node, ctx);
    case "Text3D":
      return renderText(tree, node, ctx);
    case "TextShadow3D":
      return renderTextShadow(tree, node, ctx);
    case "HtmlElement":
      return renderHtml(tree, node, ctx, hints);
    default:
      return renderUnknown(tree, ctx);
  }
}

/** Generic wrapper for 3DUI leaves: carries id, data attributes, and layout. */
function leaf(
  tree: SpecTreeNode,
  ctx: RenderContext,
  options: {
    tag?: string;
    className?: string;
    style?: CSSProperties;
    clickable?: ClickableAttrs;
    children: ReactNode;
  },
): ReactNode {
  const attrs = outerAttrs(tree.node, ctx, options.style, options.className);
  const clickable = options.clickable ?? {};
  return createElement(
    options.tag ?? "div",
    {
      ...attrs,
      ...clickable,
      className: classes(attrs.className, clickable.onClick && styles.clickable),
    },
    annotationFor(tree.node.id, ctx),
    options.children,
  );
}

function leafBehavior(
  tree: SpecTreeNode,
  ctx: RenderContext,
): { behavior: NodeBehavior; clickable: ClickableAttrs } {
  const behavior = describeBehavior(tree.node.id, ctx);
  const interactive = hasInteractiveContent(tree);
  const clickable = interactive
    ? clickableAttrs({ ...behavior, toggles: [] }, ctx, false)
    : clickableAttrs(behavior, ctx, false);
  return { behavior, clickable };
}

type NodeOf<C extends ReconstructionNode["component"]> = Extract<
  ReconstructionNode,
  { component: C }
>;

function renderButton(
  tree: SpecTreeNode,
  node: NodeOf<"Button3D">,
  ctx: RenderContext,
  hints: RenderHints,
): ReactNode {
  const p = node.props ?? ({} as NodeOf<"Button3D">["props"]);
  const behavior = describeBehavior(node.id, ctx);
  const clickable = clickableAttrs(behavior, ctx, true, true);
  const label = str(p.label).trim() || "Button";
  const buttonType =
    p.buttonType === "submit" || p.buttonType === "reset" ? p.buttonType : "button";
  const explicitTilt = num(p.tilt);
  const tilt =
    explicitTilt !== undefined && Number.isInteger(explicitTilt)
      ? explicitTilt % 6
      : hints.buttonIndex % 6;

  const commonProps = {
    width: num(p.width, 1),
    height: num(p.height, 1),
    depth: num(p.depth),
    spin: spinFlag(p.spin),
    nested: p.nested === true,
    tilt,
    face: safeCssColor(p.face, "var(--spec-accent)"),
    ink: safeCssColor(p.ink, "var(--spec-bg)"),
    fontFamily: safeFontFamily(p.fontFamily, "var(--spec-font)"),
    disabled: p.disabled === true,
    type: buttonType,
    ...clickable,
  } as const;

  if (hints.inGroup) {
    // Inside a Button3DGroup the button itself must be the direct child, so it
    // carries the node attributes and (if any) the annotation.
    const attrs = outerAttrs(node, ctx);
    return (
      <Button3D {...commonProps} {...attrs}>
        {annotationFor(node.id, ctx, true)}
        {label}
      </Button3D>
    );
  }

  return leaf(tree, ctx, {
    className: styles.leaf,
    children: (
      <>
        <Button3D {...commonProps}>{label}</Button3D>
        {renderChildren(tree.children, ctx, "Button3D")}
      </>
    ),
  });
}

function renderButtonGroup(
  tree: SpecTreeNode,
  node: NodeOf<"Button3DGroup">,
  ctx: RenderContext,
): ReactNode {
  const buttons = tree.children.filter((child) => child.node.component === "Button3D");
  const others = tree.children.filter((child) => child.node.component !== "Button3D");
  return leaf(tree, ctx, {
    className: styles.leaf,
    children: (
      <>
        <Button3DGroup>{renderChildren(buttons, ctx, "Button3DGroup")}</Button3DGroup>
        {others.length > 0 ? renderChildren(others, ctx, node.component) : null}
      </>
    ),
  });
}

function renderCard(tree: SpecTreeNode, node: NodeOf<"Card3D">, ctx: RenderContext): ReactNode {
  const p = node.props ?? ({} as NodeOf<"Card3D">["props"]);
  const { behavior, clickable } = leafBehavior(tree, ctx);
  const element = leaf(tree, ctx, {
    className: styles.leaf,
    clickable,
    children: (
      <Card3D
        width={num(p.width, 1)}
        height={num(p.height, 1)}
        depth={num(p.depth)}
        face={safeCssColor(p.face, "var(--spec-surface)")}
        ink={safeCssColor(p.ink, "var(--spec-ink)")}
        fontFamily={safeFontFamily(p.fontFamily, "var(--spec-font)")}
      >
        <div className={styles.cardBody}>{renderChildren(tree.children, ctx, "Card3D")}</div>
      </Card3D>
    ),
  });
  return wrapNavigation(tree, behavior, element);
}

function renderCarousel(
  tree: SpecTreeNode,
  node: NodeOf<"Carousel3D">,
  ctx: RenderContext,
): ReactNode {
  const p = node.props ?? ({} as NodeOf<"Carousel3D">["props"]);
  const behavior = describeBehavior(node.id, ctx);
  const clickable = clickableAttrs({ ...behavior, toggles: [] }, ctx, false);
  const itemCount = num(p.itemCount, 1);
  const count =
    itemCount !== undefined && Number.isInteger(itemCount) ? itemCount : undefined;
  const items = tree.children.map((child, index) => (
    <span
      key={child.node.id}
      data-node-id={child.node.id}
      data-node-component={child.node.component}
      className={ctx.highlighted.has(child.node.id) ? styles.highlight : undefined}
    >
      {labelOf(child, index)}
    </span>
  ));
  const layoutStyle = layoutToStyle(node.layout);
  return leaf(tree, ctx, {
    className: styles.carouselStage,
    style: { width: layoutStyle.width ?? "100%", height: layoutStyle.height ?? "520px" },
    clickable,
    children: (
      <Carousel3D spin={spinFlag(p.spin)} count={count ?? (items.length || undefined)}>
        {items}
      </Carousel3D>
    ),
  });
}

function renderChrome(tree: SpecTreeNode, node: NodeOf<"Chrome3D">, ctx: RenderContext): ReactNode {
  const p = node.props ?? ({} as NodeOf<"Chrome3D">["props"]);
  const { clickable } = leafBehavior(tree, ctx);
  const layoutStyle = layoutToStyle(node.layout);
  return leaf(tree, ctx, {
    className: styles.leaf,
    style: {
      position: layoutStyle.position ?? "relative",
      height: layoutStyle.height ?? "360px",
      width: layoutStyle.width ?? "min(100%, 720px)",
    },
    clickable,
    children: (
      <Chrome3D depth={num(p.depth)}>
        <div className={styles.chromeBody}>{renderChildren(tree.children, ctx, "Chrome3D")}</div>
      </Chrome3D>
    ),
  });
}

function renderIcon(tree: SpecTreeNode, node: NodeOf<"Icon3D">, ctx: RenderContext): ReactNode {
  const p = node.props ?? ({} as NodeOf<"Icon3D">["props"]);
  const { behavior, clickable } = leafBehavior(tree, ctx);
  const name = str(p.name);
  const known = (ICON3D_NAMES as readonly string[]).includes(name);
  const element = leaf(tree, ctx, {
    tag: "span",
    className: styles.inlineLeaf,
    clickable,
    children: (
      <>
        {known ? (
          <Icon3D
            name={name as Icon3DName}
            size={num(p.size, 1)}
            depth={num(p.depth)}
            spin={spinFlag(p.spin)}
            face={safeCssColor(p.face, "var(--spec-accent)")}
          />
        ) : (
          <span className={styles.visuallyHidden}>
            Unsupported icon {name || "(unnamed)"}
          </span>
        )}
        {renderChildren(tree.children, ctx, "Icon3D")}
      </>
    ),
  });
  return wrapNavigation(tree, behavior, element);
}

function renderImage(tree: SpecTreeNode, node: NodeOf<"Image3D">, ctx: RenderContext): ReactNode {
  const p = node.props ?? ({} as NodeOf<"Image3D">["props"]);
  const { behavior, clickable } = leafBehavior(tree, ctx);
  const assetId = str(p.assetId).trim();
  const alt = str(p.alt);
  const element = leaf(tree, ctx, {
    className: styles.leaf,
    clickable,
    children: (
      <>
        {assetId ? (
          <Image3D width={num(p.width, 1)} height={num(p.height, 1)} depth={num(p.depth)}>
            {/* eslint-disable-next-line @next/next/no-img-element -- Image3D expects a plain <img>; the source is the local /api/assets route serving cached bytes, so next/image gains nothing here. */}
            <img src={ctx.assetUrl(assetId)} alt={alt} loading="lazy" decoding="async" />
          </Image3D>
        ) : (
          <span className={styles.visuallyHidden}>Image asset missing{alt ? `: ${alt}` : ""}</span>
        )}
        {renderChildren(tree.children, ctx, "Image3D")}
      </>
    ),
  });
  return wrapNavigation(tree, behavior, element);
}

function renderText(tree: SpecTreeNode, node: NodeOf<"Text3D">, ctx: RenderContext): ReactNode {
  const p = node.props ?? ({} as NodeOf<"Text3D">["props"]);
  const { behavior, clickable } = leafBehavior(tree, ctx);
  const tag = TEXT3D_TAGS.has(str(p.semanticTag)) ? str(p.semanticTag) : "div";
  const element = leaf(tree, ctx, {
    tag,
    className: HEADING_TAGS.has(tag)
      ? styles.heading
      : tag === "span"
        ? styles.inlineLeaf
        : styles.leaf,
    clickable,
    children: (
      <>
        <Text3D
          fontSize={num(p.fontSize, 1)}
          depth={num(p.depth)}
          ink={safeCssColor(p.ink, "var(--spec-ink)")}
          fontFamily={safeFontFamily(p.fontFamily, "var(--spec-font)")}
        >
          {str(p.text)}
        </Text3D>
        {renderChildren(tree.children, ctx, "Text3D")}
      </>
    ),
  });
  return wrapNavigation(tree, behavior, element);
}

function renderTextShadow(
  tree: SpecTreeNode,
  node: NodeOf<"TextShadow3D">,
  ctx: RenderContext,
): ReactNode {
  const p = node.props ?? ({} as NodeOf<"TextShadow3D">["props"]);
  const { behavior, clickable } = leafBehavior(tree, ctx);
  const tag = TEXT_SHADOW_TAGS.has(str(p.semanticTag)) ? str(p.semanticTag) : "span";
  const element = leaf(tree, ctx, {
    tag,
    className: tag === "p" ? styles.paragraph : tag === "span" ? styles.inlineLeaf : undefined,
    clickable,
    children: (
      <>
        <TextShadow3D
          fontSize={num(p.fontSize, 1)}
          depth={num(p.depth)}
          ink={safeCssColor(p.ink, "var(--spec-ink)")}
          fontFamily={safeFontFamily(p.fontFamily, "var(--spec-font)")}
        >
          {str(p.text)}
        </TextShadow3D>
        {renderChildren(tree.children, ctx, "TextShadow3D")}
      </>
    ),
  });
  return wrapNavigation(tree, behavior, element);
}

function renderHtml(
  tree: SpecTreeNode,
  node: NodeOf<"HtmlElement">,
  ctx: RenderContext,
  hints: RenderHints,
): ReactNode {
  const p = node.props ?? ({} as NodeOf<"HtmlElement">["props"]);
  const tag: HtmlTag = HTML_TAGS.has(str(p.tag)) ? p.tag : "div";
  const behavior = describeBehavior(node.id, ctx);
  const text = str(p.text);
  const ariaLabel =
    LABELLED_HTML_TAGS.has(tag) && str(p.ariaLabel).trim() ? p.ariaLabel : undefined;
  const children = renderChildren(tree.children, ctx, "HtmlElement");
  const annotation = annotationFor(node.id, ctx);

  switch (tag) {
    case "a": {
      const href = resolveDestination(p.href, ctx.sourceUrl) ?? behavior.navigateUrl;
      if (!href) {
        const clickable = clickableAttrs(behavior, ctx, false);
        const attrs = outerAttrs(node, ctx, undefined, clickable.onClick ? styles.clickable : undefined);
        return (
          <span {...attrs} {...clickable} aria-label={ariaLabel}>
            {annotation}
            {text}
            {children}
          </span>
        );
      }
      const clickable = clickableAttrs(behavior, ctx, true);
      const attrs = outerAttrs(node, ctx, undefined, styles.link);
      const fallbackLabel = !text.trim() && children.length === 0 ? hostOf(href) : null;
      return (
        <a
          {...attrs}
          {...clickable}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={ariaLabel}
        >
          {annotation}
          {text}
          {fallbackLabel}
          {children}
        </a>
      );
    }

    case "form": {
      const attrs = outerAttrs(node, ctx);
      const submitted = ctx.submittedForms.has(node.id);
      const onSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        ctx.markSubmitted(node.id);
      };
      return (
        <form {...attrs} onSubmit={onSubmit} aria-label={ariaLabel} title={behavior.titles.join(" ") || undefined}>
          {annotation}
          {text}
          {children}
          <p className={styles.formNote} role="status" aria-live="polite" data-form-note>
            {submitted
              ? "Simulated submission received. Nothing was sent."
              : "Form submission is simulated in the reconstruction."}
          </p>
        </form>
      );
    }

    case "input": {
      const type = INPUT_TYPES.has(str(p.inputType)) ? str(p.inputType) : "text";
      const attrs = outerAttrs(node, ctx, undefined, styles.field);
      const clickable = clickableAttrs(behavior, ctx, true);
      const isCheck = type === "checkbox" || type === "radio";
      const control = (
        <input
          {...attrs}
          {...clickable}
          type={type}
          name={str(p.name) || undefined}
          placeholder={isCheck || type === "submit" ? undefined : str(p.placeholder) || undefined}
          required={p.required === true}
          aria-label={ariaLabel}
          defaultValue={type === "submit" ? text.trim() || "Submit" : undefined}
        />
      );
      if (isCheck && text.trim()) {
        return (
          <label className={styles.inlineLeaf} style={{ position: "relative" }}>
            {annotation}
            {control} {text}
          </label>
        );
      }
      return (
        <>
          {annotateOutside(node.id, ctx, control, true)}
          {children}
        </>
      );
    }

    case "textarea": {
      const attrs = outerAttrs(node, ctx, undefined, styles.field);
      const control = (
        <textarea
          {...attrs}
          name={str(p.name) || undefined}
          placeholder={str(p.placeholder) || undefined}
          required={p.required === true}
          aria-label={ariaLabel}
          defaultValue={text}
          rows={3}
        />
      );
      return annotateOutside(node.id, ctx, control, true);
    }

    case "select": {
      const attrs = outerAttrs(node, ctx, undefined, styles.field);
      const control = (
        <select
          {...attrs}
          name={str(p.name) || undefined}
          required={p.required === true}
          aria-label={ariaLabel}
        >
          {children}
        </select>
      );
      return annotateOutside(node.id, ctx, control, true);
    }

    case "option": {
      const attrs = outerAttrs(node, ctx);
      return (
        <option {...attrs} value={text}>
          {text || "Option"}
        </option>
      );
    }

    case "ul":
    case "ol": {
      const attrs = outerAttrs(node, ctx, undefined, styles.list);
      const list = createElement(tag, attrs, children);
      return wrapNavigation(tree, behavior, annotateOutside(node.id, ctx, list, false));
    }

    case "label": {
      const attrs = outerAttrs(node, ctx);
      return (
        <label {...attrs} htmlFor={hints.labelFor}>
          {annotation}
          {text}
          {children}
        </label>
      );
    }

    default: {
      const interactive = hasInteractiveContent(tree);
      const clickable = clickableAttrs(
        interactive ? { ...behavior, toggles: [] } : behavior,
        ctx,
        false,
      );
      const attrs = outerAttrs(
        node,
        ctx,
        undefined,
        classes(tag === "p" ? styles.paragraph : undefined, clickable.onClick && styles.clickable),
      );
      const element = createElement(
        tag,
        { ...attrs, ...clickable, "aria-label": ariaLabel },
        annotation,
        text,
        ...children,
      );
      return wrapNavigation(tree, behavior, element);
    }
  }
}

function renderUnknown(tree: SpecTreeNode, ctx: RenderContext): ReactNode {
  const component = str((tree.node as { component?: unknown }).component) || "unknown";
  return leaf(tree, ctx, {
    tag: "span",
    className: styles.inlineLeaf,
    children: (
      <>
        <span className={styles.visuallyHidden}>Unsupported component {component}</span>
        {renderChildren(tree.children, ctx)}
      </>
    ),
  });
}

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Renders a `ReconstructionSpec` (complete or partial) onto the approved 3DUI
 * primitives. Every node is treated as data: text is rendered as text, colours
 * and fonts are validated before reaching the DOM, and link destinations are
 * resolved to `http(s)` URLs only.
 */
export function SpecRenderer(props: SpecRendererProps) {
  const {
    nodes,
    page,
    source,
    interactions = EMPTY_INTERACTIONS,
    highlightNodeIds = EMPTY_IDS,
    highlightColor = RECONSTRUCTION_HIGHLIGHT_COLOR,
    annotations = EMPTY_ANNOTATIONS,
    assetUrl = defaultAssetUrl,
    streaming = false,
    className,
  } = props;

  const reactId = useId();
  const domId = useCallback((nodeId: string) => `spec${reactId}${nodeId}`, [reactId]);

  const tree = useMemo(() => buildSpecTree(nodes ?? []), [nodes]);

  const interactionsBySource = useMemo(() => {
    const map = new Map<string, ReconstructionInteraction[]>();
    for (const interaction of interactions) {
      if (!interaction || typeof interaction.sourceNodeId !== "string") continue;
      const list = map.get(interaction.sourceNodeId);
      if (list) list.push(interaction);
      else map.set(interaction.sourceNodeId, [interaction]);
    }
    return map;
  }, [interactions]);

  const initiallyHidden = useMemo(() => {
    const set = new Set<string>();
    for (const interaction of interactions) {
      if (interaction?.action === "show" && interaction.targetNodeId) {
        set.add(interaction.targetNodeId);
      }
    }
    return set;
  }, [interactions]);

  const [hiddenOverrides, setHiddenOverrides] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  );
  const [submittedForms, setSubmittedForms] = useState<ReadonlySet<string>>(() => new Set());

  const isHidden = useCallback(
    (id: string) => hiddenOverrides.get(id) ?? initiallyHidden.has(id),
    [hiddenOverrides, initiallyHidden],
  );
  const setHidden = useCallback(
    (id: string, next: boolean | ((previous: boolean) => boolean)) => {
      setHiddenOverrides((previous) => {
        const current = previous.get(id) ?? initiallyHidden.has(id);
        const value = typeof next === "function" ? next(current) : next;
        if (value === current && previous.has(id)) return previous;
        const map = new Map(previous);
        map.set(id, value);
        return map;
      });
    },
    [initiallyHidden],
  );
  const markSubmitted = useCallback((id: string) => {
    setSubmittedForms((previous) => {
      if (previous.has(id)) return previous;
      const set = new Set(previous);
      set.add(id);
      return set;
    });
  }, []);

  const highlighted = useMemo(() => new Set(highlightNodeIds), [highlightNodeIds]);

  const ctx: RenderContext = {
    sourceUrl: source?.url,
    assetUrl,
    interactionsBySource,
    highlighted,
    annotations,
    isHidden,
    setHidden,
    submittedForms,
    markSubmitted,
    domId,
  };

  const theme = page?.theme;
  const rootStyle = {
    "--spec-bg": safeCssColor(theme?.background, DEFAULT_THEME.background),
    "--spec-surface": safeCssColor(theme?.surface, DEFAULT_THEME.surface),
    "--spec-ink": safeCssColor(theme?.ink, DEFAULT_THEME.ink),
    "--spec-accent": safeCssColor(theme?.accent, DEFAULT_THEME.accent),
    "--spec-font": safeFontFamily(theme?.fontFamily, DEFAULT_THEME.fontFamily),
    "--spec-highlight": safeCssColor(highlightColor, RECONSTRUCTION_HIGHLIGHT_COLOR),
    background: "var(--spec-bg)",
    color: "var(--spec-ink)",
    fontFamily: "var(--spec-font)",
    maxWidth: num(page?.maxWidth, 1) !== undefined ? `${page!.maxWidth}px` : undefined,
    padding: `${num(page?.padding) ?? 24}px`,
    gap: `${num(page?.gap) ?? 24}px`,
  } as CSSProperties;

  const nodeCount = tree.byId.size;
  const pageTitle = str(page?.title).trim();

  return (
    <div
      data-spec-renderer=""
      className={classes(styles.root, className)}
      style={rootStyle}
      role="region"
      aria-label={pageTitle ? `Reconstruction of ${pageTitle}` : "Reconstructed page"}
      aria-busy={streaming || undefined}
    >
      {tree.roots.length === 0 ? (
        <p className={styles.muted} data-spec-empty>
          No reconstructed nodes yet.
        </p>
      ) : (
        renderChildren(tree.roots, ctx)
      )}
      {streaming ? (
        <p className={styles.footer} role="status" aria-live="polite" data-spec-streaming>
          Streaming reconstruction… {nodeCount} {nodeCount === 1 ? "node" : "nodes"} so far
        </p>
      ) : null}
    </div>
  );
}
