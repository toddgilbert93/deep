import type {
  ReconstructionInteraction,
  ReconstructionNode,
  ReconstructionSpec,
} from "@/lib/reconstruction/events";

/**
 * Props for the runtime renderer that maps a validated `ReconstructionSpec`
 * (or a partial, still-streaming node set) onto the approved 3DUI primitives.
 *
 * The renderer must treat every node as data: it never executes or injects
 * node text as markup, and it only renders components/props allowed by the
 * reconstruction contract.
 */
export interface SpecRendererProps {
  /** Complete or partial node list. Order/hierarchy come from `parentId` + `order`. */
  nodes: readonly ReconstructionNode[];
  /** Page metadata (theme, width, padding). Optional while streaming. */
  page?: ReconstructionSpec["page"];
  /** Source metadata used to resolve relative link destinations. */
  source?: ReconstructionSpec["source"];
  /** Validated interactions to wire onto rendered nodes. */
  interactions?: readonly ReconstructionInteraction[];
  /** Node IDs to outline with `highlightColor` (Phase 3 live focus). */
  highlightNodeIds?: readonly string[];
  /** Outline color; defaults to the contract's green highlight. */
  highlightColor?: string;
  /** Floating annotation text per node ID, shown beside highlighted nodes. */
  annotations?: Readonly<Record<string, string>>;
  /** Builds the URL used for `Image3D` assets. Defaults to `/api/assets/{assetId}`. */
  assetUrl?: (assetId: string) => string;
  /** When true, the renderer is showing a still-streaming, incomplete tree. */
  streaming?: boolean;
  className?: string;
}

export function defaultAssetUrl(assetId: string): string {
  return `/api/assets/${encodeURIComponent(assetId)}`;
}
