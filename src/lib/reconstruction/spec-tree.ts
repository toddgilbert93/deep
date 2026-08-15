/**
 * Pure helpers for turning a flat `ReconstructionSpec.nodes` list (complete or
 * still streaming) into a render tree, and for mapping spec layout/theme values
 * onto safe CSS.
 *
 * Nothing in this module touches React or the DOM, so it can be unit tested
 * with `node:test` and shared by any renderer.
 */
import type { CSSProperties } from "react";
import type {
  ReconstructionLayout,
  ReconstructionNode,
} from "../../../backend/src/reconstruction/reconstruction-spec";

export interface SpecTreeNode {
  node: ReconstructionNode;
  children: SpecTreeNode[];
}

export interface SpecTree {
  /** Top-level nodes: no `parentId`, a missing parent, or a broken cycle. */
  roots: SpecTreeNode[];
  /** Every deduplicated node by id (last occurrence wins). */
  byId: Map<string, SpecTreeNode>;
  /**
   * Ids promoted to roots because their parent is absent from the node set
   * (typical while streaming), because they parent themselves, or because
   * their parent chain forms a cycle.
   */
  orphanIds: string[];
}

function compareSiblings(a: SpecTreeNode, b: SpecTreeNode): number {
  if (a.node.order !== b.node.order) return a.node.order - b.node.order;
  return a.node.id < b.node.id ? -1 : a.node.id > b.node.id ? 1 : 0;
}

/**
 * Builds a parent/child tree from a flat node list.
 *
 * - Duplicate ids are collapsed; the last occurrence wins (safe for replayed
 *   `reconstruction.node` snapshots).
 * - Children are sorted by `order`, then by id for a stable tiebreak.
 * - Nodes whose parent is missing, or whose parent chain never reaches a real
 *   root (a cycle), are promoted to roots and reported in `orphanIds`.
 */
export function buildSpecTree(nodes: readonly ReconstructionNode[]): SpecTree {
  const latest = new Map<string, ReconstructionNode>();
  for (const node of nodes) {
    if (!node || typeof node.id !== "string") continue;
    latest.delete(node.id);
    latest.set(node.id, node);
  }

  const byId = new Map<string, SpecTreeNode>();
  for (const node of latest.values()) {
    byId.set(node.id, { node, children: [] });
  }

  const roots: SpecTreeNode[] = [];
  const orphanIds: string[] = [];
  const attached: SpecTreeNode[] = [];

  for (const tree of byId.values()) {
    const parentId = tree.node.parentId;
    const parent =
      parentId !== undefined && parentId !== tree.node.id
        ? byId.get(parentId)
        : undefined;
    if (parent) {
      parent.children.push(tree);
      attached.push(tree);
    } else {
      roots.push(tree);
      if (parentId !== undefined) orphanIds.push(tree.node.id);
    }
  }

  // Anything not reachable from a root sits inside a parent cycle. Break each
  // cycle at its first-seen member by promoting it to a root.
  const reached = new Set<string>();
  const markReached = (tree: SpecTreeNode) => {
    const stack = [tree];
    while (stack.length) {
      const current = stack.pop()!;
      if (reached.has(current.node.id)) continue;
      reached.add(current.node.id);
      stack.push(...current.children);
    }
  };
  roots.forEach(markReached);

  for (const tree of attached) {
    if (reached.has(tree.node.id)) continue;
    const parent = byId.get(tree.node.parentId!);
    if (parent) {
      parent.children = parent.children.filter((child) => child !== tree);
    }
    roots.push(tree);
    orphanIds.push(tree.node.id);
    markReached(tree);
  }

  roots.sort(compareSiblings);
  for (const tree of byId.values()) {
    tree.children.sort(compareSiblings);
  }

  return { roots, byId, orphanIds };
}

const ALIGN_MAP = {
  start: "flex-start",
  end: "flex-end",
  center: "center",
  stretch: "stretch",
  "space-between": "space-between",
  "space-around": "space-around",
} as const;

function px(value: number | undefined): string | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value}px`
    : undefined;
}

/**
 * Maps a spec `layout` object onto inline CSS. Unknown or malformed values are
 * dropped rather than passed through.
 */
export function layoutToStyle(
  layout: ReconstructionLayout | undefined,
): CSSProperties {
  const style: CSSProperties = {};
  if (!layout || typeof layout !== "object") return style;

  if (layout.display) style.display = layout.display;
  if (layout.position) style.position = layout.position;

  const fixedWidth = px(layout.width);
  switch (layout.widthMode) {
    case "full":
      style.width = "100%";
      break;
    case "fit":
      style.width = "fit-content";
      break;
    case "fixed":
      if (fixedWidth) style.width = fixedWidth;
      break;
    case "auto":
      break;
    default:
      if (fixedWidth) style.width = fixedWidth;
  }

  const height = px(layout.height);
  if (height) style.height = height;
  const maxWidth = px(layout.maxWidth);
  if (maxWidth) style.maxWidth = maxWidth;
  const gap = px(layout.gap);
  if (gap) style.gap = gap;
  const padding = px(layout.padding);
  if (padding) style.padding = padding;

  if (layout.flexDirection) {
    style.flexDirection = layout.flexDirection;
    if (!style.display) style.display = "flex";
  }
  if (layout.alignItems && layout.alignItems in ALIGN_MAP) {
    style.alignItems = ALIGN_MAP[layout.alignItems];
  }
  if (layout.justifyContent && layout.justifyContent in ALIGN_MAP) {
    style.justifyContent = ALIGN_MAP[layout.justifyContent];
  }
  if (
    typeof layout.gridColumns === "number" &&
    Number.isInteger(layout.gridColumns) &&
    layout.gridColumns > 0
  ) {
    style.display = "grid";
    style.gridTemplateColumns = `repeat(${layout.gridColumns}, minmax(0, 1fr))`;
  }
  if (typeof layout.order === "number" && Number.isFinite(layout.order)) {
    style.order = layout.order;
  }

  return style;
}

/**
 * Resolves a link/interaction destination against the source page URL and
 * returns an absolute `http(s)` URL, or `null` for anything else
 * (`javascript:`, `data:`, `mailto:`, unresolvable relatives, garbage).
 */
export function resolveDestination(
  destination: string | undefined,
  sourceUrl: string | undefined,
): string | null {
  if (typeof destination !== "string") return null;
  const trimmed = destination.trim();
  if (!trimmed) return null;

  let resolved: URL;
  try {
    resolved =
      typeof sourceUrl === "string" && sourceUrl.trim()
        ? new URL(trimmed, sourceUrl)
        : new URL(trimmed);
  } catch {
    return null;
  }

  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
    return null;
  }
  return resolved.href;
}

const COLOR_PATTERNS: readonly RegExp[] = [
  /^#[0-9a-f]{3,8}$/i,
  /^[a-z]{3,32}$/i,
  /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\([^()]{1,80}\)$/i,
  /^color\([^()]{1,80}\)$/i,
  /^color-mix\([^()]*(?:\((?:[^()]|\([^()]*\))*\)[^()]*)*\)$/i,
  /^var\(--[a-z0-9_-]{1,64}(?:,\s*[^()]{0,80})?\)$/i,
];

/**
 * Accepts a CSS colour string from the spec only when it looks like a colour
 * (hex, named, functional colour, `color-mix`, or a `var(--token)`), otherwise
 * returns `fallback`. Model-provided values never reach the DOM unchecked.
 */
export function safeCssColor(
  value: string | undefined,
  fallback: string,
): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200) return fallback;
  if (/url\s*\(|expression\s*\(|[;{}<>]/i.test(trimmed)) return fallback;
  return COLOR_PATTERNS.some((pattern) => pattern.test(trimmed))
    ? trimmed
    : fallback;
}

/**
 * Accepts a CSS `font-family` list from the spec: family names, quoted names,
 * generic keywords, and `var(--token)` entries. Anything with functions other
 * than `var()`, URLs, or statement characters falls back.
 */
export function safeFontFamily(
  value: string | undefined,
  fallback: string,
): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 300) return fallback;
  if (/[;{}<>\\]|url\s*\(|expression\s*\(/i.test(trimmed)) return fallback;
  const withoutVars = trimmed.replace(
    /var\(--[a-z0-9_-]{1,64}(?:,\s*[^()]{0,80})?\)/gi,
    "",
  );
  if (/[()]/.test(withoutVars)) return fallback;
  return trimmed;
}
