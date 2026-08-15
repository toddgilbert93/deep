import type { GrokUsage } from "../providers/grok";
import type {
  ReconstructionNode,
  ReconstructionSpec,
} from "../reconstruction/reconstruction-spec";
import type { UiElement } from "../webpage/parse-webpage-ui";
import type { DesignPage } from "../design/design-tree";

export const RECONSTRUCTION_EVENT_VERSION = "1.0" as const;
export const RECONSTRUCTION_HIGHLIGHT_COLOR = "#22c55e" as const;

export type ReconstructionStage =
  | "fetching_source"
  | "parsing_dom"
  | "caching_assets"
  | "preparing_agent"
  | "designing"
  | "rendering"
  | "reconstructing"
  | "validating_spec"
  | "presenting_result"
  | "completed"
  | "failed";

interface ReconstructionEventBase {
  eventVersion: typeof RECONSTRUCTION_EVENT_VERSION;
  jobId: string;
  sequence: number;
  emittedAt: string;
  stage: ReconstructionStage;
  progress: number;
}

export interface ReconstructionStatusEvent extends ReconstructionEventBase {
  type: "workflow.status";
  status: "started" | "progress" | "completed";
  message: string;
  counts?: {
    elements?: number;
    connections?: number;
    images?: number;
    nodes?: number;
  };
}

export type StreamedSourceElement = Pick<
  UiElement,
  | "id"
  | "kind"
  | "tag"
  | "role"
  | "name"
  | "text"
  | "selector"
  | "parentId"
  | "state"
  | "assetId"
>;

export interface SourceElementEvent extends ReconstructionEventBase {
  type: "source.element";
  message: string;
  element: StreamedSourceElement;
  focus: {
    sourceElementIds: string[];
    reconstructionNodeIds: string[];
    assetIds: string[];
    highlightColor: typeof RECONSTRUCTION_HIGHLIGHT_COLOR;
  };
  annotation: string;
}

export interface ReconstructionNodeEvent extends ReconstructionEventBase {
  type: "reconstruction.node";
  message: string;
  node: ReconstructionNode;
  focus: {
    sourceElementIds: string[];
    reconstructionNodeIds: string[];
    assetIds: string[];
    highlightColor: typeof RECONSTRUCTION_HIGHLIGHT_COLOR;
  };
  annotation: string;
}

/**
 * A snapshot of the page Grok is designing, parsed into the validated
 * `DesignPage` tree. Snapshots are idempotent: replace the whole preview with
 * the newest one. `partial` is true while the model is still streaming.
 */
export interface DesignPageEvent extends ReconstructionEventBase {
  type: "design.page";
  message: string;
  page: DesignPage;
  /** Generated characters received so far, for a live "building" indicator. */
  generatedCharacters: number;
}

export interface ReconstructionCompletedEvent extends ReconstructionEventBase {
  type: "workflow.completed";
  message: string;
  status: "completed";
  model: string;
  responseId: string;
  usage?: GrokUsage;
  /** Present for design-pipeline jobs. */
  page?: DesignPage;
  /** Present for legacy spec-pipeline jobs. */
  result?: ReconstructionSpec;
}

export interface ReconstructionFailedEvent extends ReconstructionEventBase {
  type: "workflow.failed";
  message: string;
  status: "failed";
  error: {
    code: string;
    retryable: boolean;
  };
}

export type ReconstructionEvent =
  | ReconstructionStatusEvent
  | DesignPageEvent
  | SourceElementEvent
  | ReconstructionNodeEvent
  | ReconstructionCompletedEvent
  | ReconstructionFailedEvent;

export type ReconstructionEventInput =
  | Omit<ReconstructionStatusEvent, keyof ReconstructionEventBase>
  | Omit<DesignPageEvent, keyof ReconstructionEventBase>
  | Omit<SourceElementEvent, keyof ReconstructionEventBase>
  | Omit<ReconstructionNodeEvent, keyof ReconstructionEventBase>
  | Omit<ReconstructionCompletedEvent, keyof ReconstructionEventBase>
  | Omit<ReconstructionFailedEvent, keyof ReconstructionEventBase>;

export type ReconstructionEventSink = (
  event: ReconstructionEvent,
) => void | Promise<void>;

export interface ReconstructionEventEmitter {
  emit(
    stage: ReconstructionStage,
    progress: number,
    input: ReconstructionEventInput,
  ): Promise<ReconstructionEvent>;
}

export function createReconstructionEventEmitter(
  jobId: string,
  sink: ReconstructionEventSink = () => undefined,
  now: () => Date = () => new Date(),
): ReconstructionEventEmitter {
  let sequence = 0;

  return {
    async emit(stage, progress, input) {
      const event = {
        eventVersion: RECONSTRUCTION_EVENT_VERSION,
        jobId,
        sequence: ++sequence,
        emittedAt: now().toISOString(),
        stage,
        progress: clampProgress(progress),
        ...input,
      } as ReconstructionEvent;
      await sink(event);
      return event;
    },
  };
}

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(progress)));
}
