/**
 * Frontend view of the workflow event contract.
 *
 * The canonical definitions live in `backend/src/workflow/reconstruction-events.ts`.
 * Only *types* are imported from the backend so nothing Node-only reaches the
 * client bundle; the type-only imports are erased at compile time.
 */
import type {
  DesignElementNode,
  DesignNode,
  DesignPage,
} from "../../../backend/src/design/design-tree";
import type {
  DesignPageEvent,
  ReconstructionCompletedEvent,
  ReconstructionEvent,
  ReconstructionFailedEvent,
  ReconstructionNodeEvent,
  ReconstructionStage,
  ReconstructionStatusEvent,
  SourceElementEvent,
  StreamedSourceElement,
} from "../../../backend/src/workflow/reconstruction-events";
import type {
  ReconstructionInteraction,
  ReconstructionNode,
  ReconstructionSpec,
} from "../../../backend/src/reconstruction/reconstruction-spec";

export type {
  DesignElementNode,
  DesignNode,
  DesignPage,
  DesignPageEvent,
  ReconstructionCompletedEvent,
  ReconstructionEvent,
  ReconstructionFailedEvent,
  ReconstructionInteraction,
  ReconstructionNode,
  ReconstructionNodeEvent,
  ReconstructionSpec,
  ReconstructionStage,
  ReconstructionStatusEvent,
  SourceElementEvent,
  StreamedSourceElement,
};

export const RECONSTRUCTION_EVENT_VERSION = "1.0" as const;
export const RECONSTRUCTION_HIGHLIGHT_COLOR = "#22c55e" as const;

export const RECONSTRUCTION_EVENT_TYPES = [
  "workflow.status",
  "design.page",
  "source.element",
  "reconstruction.node",
  "workflow.completed",
  "workflow.failed",
] as const;

export const RECONSTRUCTION_STAGES: readonly ReconstructionStage[] = [
  "fetching_source",
  "parsing_dom",
  "caching_assets",
  "preparing_agent",
  "designing",
  "rendering",
  "reconstructing",
  "validating_spec",
  "presenting_result",
  "completed",
  "failed",
];

export type ReconstructionEventType = ReconstructionEvent["type"];

export type ReconstructionErrorCode =
  | "SOURCE_FETCH_FAILED"
  | "INVALID_RECONSTRUCTION"
  | "MODEL_REQUEST_FAILED"
  | "MODEL_NOT_CONFIGURED"
  | "WORKFLOW_FAILED"
  | (string & {});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Structural guard for anything arriving over the wire. It checks the shared
 * envelope plus the discriminating fields of each event type. Payload bodies
 * (`node`, `result`) are trusted only because the backend validates them
 * before emitting; the UI still never executes or injects them as markup.
 */
export function isReconstructionEvent(value: unknown): value is ReconstructionEvent {
  if (!isRecord(value)) return false;
  if (value.eventVersion !== RECONSTRUCTION_EVENT_VERSION) return false;
  if (typeof value.jobId !== "string" || value.jobId.length === 0) return false;
  if (typeof value.sequence !== "number" || !Number.isInteger(value.sequence) || value.sequence < 1) {
    return false;
  }
  if (typeof value.emittedAt !== "string") return false;
  if (typeof value.stage !== "string" || !RECONSTRUCTION_STAGES.includes(value.stage as ReconstructionStage)) {
    return false;
  }
  if (typeof value.progress !== "number" || value.progress < 0 || value.progress > 100) {
    return false;
  }

  switch (value.type) {
    case "workflow.status":
      return typeof value.message === "string" && typeof value.status === "string";
    case "source.element":
      return (
        isRecord(value.element) &&
        typeof value.element.id === "string" &&
        isFocus(value.focus) &&
        typeof value.annotation === "string"
      );
    case "reconstruction.node":
      return (
        isRecord(value.node) &&
        typeof value.node.id === "string" &&
        typeof value.node.component === "string" &&
        isFocus(value.focus) &&
        typeof value.annotation === "string"
      );
    case "design.page":
      return (
        isRecord(value.page) &&
        Array.isArray((value.page as { nodes?: unknown }).nodes) &&
        typeof value.message === "string"
      );
    case "workflow.completed":
      return (
        value.status === "completed" &&
        typeof value.model === "string" &&
        (isDesignPage(value.page) ||
          (isRecord(value.result) && Array.isArray(value.result.nodes)))
      );
    case "workflow.failed":
      return (
        value.status === "failed" &&
        isRecord(value.error) &&
        typeof value.error.code === "string" &&
        typeof value.error.retryable === "boolean"
      );
    default:
      return false;
  }
}

function isDesignPage(value: unknown): boolean {
  return isRecord(value) && Array.isArray((value as { nodes?: unknown }).nodes);
}

function isFocus(value: unknown): boolean {
  return (
    isRecord(value) &&
    Array.isArray(value.sourceElementIds) &&
    Array.isArray(value.reconstructionNodeIds) &&
    Array.isArray(value.assetIds) &&
    typeof value.highlightColor === "string"
  );
}

export function isTerminalEvent(
  event: ReconstructionEvent,
): event is ReconstructionCompletedEvent | ReconstructionFailedEvent {
  return event.type === "workflow.completed" || event.type === "workflow.failed";
}
