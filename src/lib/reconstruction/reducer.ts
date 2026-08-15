/**
 * Transport-independent state for webpage-to-3D conversion jobs.
 *
 * Contract (see AGENTS.md "Frontend/backend workflow event contract"):
 * 1. State is isolated by `jobId`.
 * 2. Duplicate or stale events (sequence <= last applied) are ignored.
 * 3. Source elements and reconstruction nodes are upserted by stable ID.
 * 4. `workflow.completed` / `workflow.failed` are terminal; later events are ignored.
 * 5. Nothing here renders raw model text; `message`/`annotation` are plain
 *    strings the UI may show as text only.
 * 6. A transport drop preserves the last valid state (`connection: "disconnected"`).
 */
import type {
  DesignPage,
  ReconstructionEvent,
  ReconstructionNode,
  ReconstructionSpec,
  ReconstructionStage,
  StreamedSourceElement,
} from "./events";
import { RECONSTRUCTION_HIGHLIGHT_COLOR } from "./events";

export type JobStatus = "connecting" | "running" | "completed" | "failed";
export type ConnectionStatus = "connecting" | "open" | "closed" | "disconnected";

export interface JobFocus {
  sourceElementIds: string[];
  reconstructionNodeIds: string[];
  assetIds: string[];
  highlightColor: string;
  annotation: string;
  /** Sequence of the event that produced this focus (for staleness checks). */
  sequence: number;
}

export interface JobCounts {
  elements?: number;
  connections?: number;
  images?: number;
  nodes?: number;
}

export interface JobError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface JobCompletion {
  model: string;
  responseId: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    costInUsdTicks?: number;
  };
}

export interface ReconstructionJobState {
  jobId: string;
  /** The URL the user submitted; supplied by the client, not the stream. */
  sourceUrl: string | null;
  status: JobStatus;
  connection: ConnectionStatus;
  stage: ReconstructionStage | null;
  progress: number;
  lastSequence: number;
  /** Latest displayable context from the backend (text only, never parsed). */
  message: string | null;
  counts: JobCounts;
  elements: Record<string, StreamedSourceElement>;
  elementOrder: string[];
  nodes: Record<string, ReconstructionNode>;
  nodeOrder: string[];
  focus: JobFocus | null;
  result: ReconstructionSpec | null;
  /** Latest streamed or final design page (the current pipeline's output). */
  page: DesignPage | null;
  /** Characters of generated markup received so far. */
  generatedCharacters: number;
  completion: JobCompletion | null;
  error: JobError | null;
  /** Client-side transport failure message, if any (kept separate from workflow errors). */
  transportError: string | null;
  /** Events ignored as duplicate/stale/post-terminal — diagnostics only. */
  ignoredEvents: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface ReconstructionState {
  jobs: Record<string, ReconstructionJobState>;
  activeJobId: string | null;
}

export type ReconstructionAction =
  | { type: "job.start"; jobId: string; sourceUrl: string; at?: number }
  | { type: "job.event"; event: ReconstructionEvent; at?: number }
  | { type: "job.connection"; jobId: string; connection: ConnectionStatus }
  | { type: "job.transportError"; jobId: string; message: string; at?: number }
  | { type: "job.dismiss"; jobId: string }
  | { type: "reset" };

export const initialReconstructionState: ReconstructionState = {
  jobs: {},
  activeJobId: null,
};

export function createJobState(
  jobId: string,
  sourceUrl: string | null = null,
  at: number | null = null,
): ReconstructionJobState {
  return {
    jobId,
    sourceUrl,
    status: "connecting",
    connection: "connecting",
    stage: null,
    progress: 0,
    lastSequence: 0,
    message: null,
    counts: {},
    elements: {},
    elementOrder: [],
    nodes: {},
    nodeOrder: [],
    focus: null,
    result: null,
    page: null,
    generatedCharacters: 0,
    completion: null,
    error: null,
    transportError: null,
    ignoredEvents: 0,
    startedAt: at,
    finishedAt: null,
  };
}

export function reconstructionReducer(
  state: ReconstructionState,
  action: ReconstructionAction,
): ReconstructionState {
  switch (action.type) {
    case "reset":
      return initialReconstructionState;

    case "job.start": {
      const existing = state.jobs[action.jobId];
      if (existing) {
        // Restarting the same job ID is not allowed; keep the existing state.
        return { ...state, activeJobId: action.jobId };
      }
      return {
        jobs: {
          ...state.jobs,
          [action.jobId]: createJobState(action.jobId, action.sourceUrl, action.at ?? null),
        },
        activeJobId: action.jobId,
      };
    }

    case "job.dismiss": {
      if (!state.jobs[action.jobId]) return state;
      const jobs = { ...state.jobs };
      delete jobs[action.jobId];
      return {
        jobs,
        activeJobId: state.activeJobId === action.jobId ? null : state.activeJobId,
      };
    }

    case "job.connection": {
      const job = state.jobs[action.jobId];
      if (!job || job.connection === action.connection) return state;
      // A terminal job's connection closing is expected; never regress status.
      return withJob(state, { ...job, connection: action.connection });
    }

    case "job.transportError": {
      const job = state.jobs[action.jobId];
      if (!job) return state;
      if (isTerminalStatus(job.status)) {
        // The workflow already finished; a late transport error is noise.
        return withJob(state, { ...job, connection: "closed" });
      }
      return withJob(state, {
        ...job,
        connection: "disconnected",
        transportError: action.message,
      });
    }

    case "job.event":
      return applyEvent(state, action.event, action.at ?? null);

    default:
      return state;
  }
}

function withJob(state: ReconstructionState, job: ReconstructionJobState): ReconstructionState {
  return {
    ...state,
    jobs: { ...state.jobs, [job.jobId]: job },
  };
}

function isTerminalStatus(status: JobStatus): boolean {
  return status === "completed" || status === "failed";
}

function applyEvent(
  state: ReconstructionState,
  event: ReconstructionEvent,
  at: number | null,
): ReconstructionState {
  const existing = state.jobs[event.jobId] ?? createJobState(event.jobId, null, at);
  const activeJobId = state.activeJobId ?? event.jobId;

  // Rule 2 + 4: ignore stale, duplicate, and post-terminal events.
  if (event.sequence <= existing.lastSequence || isTerminalStatus(existing.status)) {
    return {
      ...state,
      activeJobId,
      jobs: {
        ...state.jobs,
        [event.jobId]: { ...existing, ignoredEvents: existing.ignoredEvents + 1 },
      },
    };
  }

  const base: ReconstructionJobState = {
    ...existing,
    status: existing.status === "connecting" ? "running" : existing.status,
    connection: existing.connection === "connecting" ? "open" : existing.connection,
    stage: event.stage,
    progress: clampProgress(event.progress),
    lastSequence: event.sequence,
    message: event.message,
    transportError: null,
  };

  let next: ReconstructionJobState;
  switch (event.type) {
    case "workflow.status":
      next = {
        ...base,
        counts: event.counts ? { ...base.counts, ...stripUndefined(event.counts) } : base.counts,
      };
      break;

    case "source.element": {
      const id = event.element.id;
      next = {
        ...base,
        elements: { ...base.elements, [id]: event.element },
        elementOrder: base.elements[id] ? base.elementOrder : [...base.elementOrder, id],
        focus: toFocus(event.focus, event.annotation, event.sequence),
      };
      break;
    }

    case "reconstruction.node": {
      const id = event.node.id;
      next = {
        ...base,
        nodes: { ...base.nodes, [id]: event.node },
        nodeOrder: base.nodes[id] ? base.nodeOrder : [...base.nodeOrder, id],
        focus: toFocus(event.focus, event.annotation, event.sequence),
      };
      break;
    }

    case "design.page":
      next = {
        ...base,
        page: event.page,
        generatedCharacters: event.generatedCharacters,
      };
      break;

    case "workflow.completed": {
      // Rule: replace incremental state with the validated result.
      const nodes: Record<string, ReconstructionNode> = {};
      const nodeOrder: string[] = [];
      for (const node of event.result?.nodes ?? []) {
        if (!nodes[node.id]) nodeOrder.push(node.id);
        nodes[node.id] = node;
      }
      next = {
        ...base,
        status: "completed",
        connection: "closed",
        progress: 100,
        nodes,
        nodeOrder,
        focus: null,
        result: event.result ?? null,
        page: event.page ?? base.page,
        completion: {
          model: event.model,
          responseId: event.responseId,
          usage: event.usage,
        },
        error: null,
        finishedAt: at,
      };
      break;
    }

    case "workflow.failed":
      next = {
        ...base,
        status: "failed",
        connection: "closed",
        focus: null,
        error: {
          code: event.error.code,
          message: event.message,
          retryable: event.error.retryable,
        },
        finishedAt: at,
      };
      break;

    default:
      next = base;
  }

  return {
    ...state,
    activeJobId,
    jobs: { ...state.jobs, [event.jobId]: next },
  };
}

function toFocus(
  focus: {
    sourceElementIds: string[];
    reconstructionNodeIds: string[];
    assetIds: string[];
    highlightColor: string;
  },
  annotation: string,
  sequence: number,
): JobFocus {
  return {
    sourceElementIds: [...focus.sourceElementIds],
    reconstructionNodeIds: [...focus.reconstructionNodeIds],
    assetIds: [...focus.assetIds],
    highlightColor: focus.highlightColor || RECONSTRUCTION_HIGHLIGHT_COLOR,
    annotation,
    sequence,
  };
}

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(100, Math.max(0, Math.round(progress)));
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      (out as Record<string, unknown>)[key] = entry;
    }
  }
  return out;
}

/** Convenience selectors. */
export function selectActiveJob(state: ReconstructionState): ReconstructionJobState | null {
  return state.activeJobId ? (state.jobs[state.activeJobId] ?? null) : null;
}

export function selectOrderedNodes(job: ReconstructionJobState): ReconstructionNode[] {
  return job.nodeOrder.map((id) => job.nodes[id]).filter(Boolean);
}

export function selectOrderedElements(job: ReconstructionJobState): StreamedSourceElement[] {
  return job.elementOrder.map((id) => job.elements[id]).filter(Boolean);
}
