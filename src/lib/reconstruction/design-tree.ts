/**
 * Client-side view of the design-tree wire contract.
 *
 * The canonical definition lives in `backend/src/design/design-tree.ts`. This
 * module re-exports only the *types* with `import type`, so nothing in the
 * browser bundle ever pulls a backend value (or a Node-only transitive import)
 * across the frontend/backend boundary. If the backend contract changes shape,
 * this file stops compiling — which is the point.
 *
 * Runtime tag allow-lists used by the renderer are declared locally in
 * `src/app/_components/design-renderer/design-tags.ts` and are checked against
 * these types at compile time.
 */

import type {
  AllowedHtmlTag as BackendAllowedHtmlTag,
  DeepComponentTag as BackendDeepComponentTag,
  DesignElementNode as BackendDesignElementNode,
  DesignNode as BackendDesignNode,
  DesignPage as BackendDesignPage,
  DesignTag as BackendDesignTag,
  DesignTextNode as BackendDesignTextNode,
} from "../../../backend/src/design/design-tree";

/** Wire format version this client understands. */
export const DESIGN_TREE_VERSION = "1.0" as const;

export type AllowedHtmlTag = BackendAllowedHtmlTag;
export type DeepComponentTag = BackendDeepComponentTag;
export type DesignTag = BackendDesignTag;
export type DesignElementNode = BackendDesignElementNode;
export type DesignTextNode = BackendDesignTextNode;
export type DesignNode = BackendDesignNode;
export type DesignPage = BackendDesignPage;
