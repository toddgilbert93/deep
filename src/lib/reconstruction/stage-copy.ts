/**
 * Frontend-owned copy for each workflow stage. UI text is selected from the
 * machine-readable `stage`, never parsed out of backend messages.
 */
import type { ReconstructionStage } from "./events";
import type { ReconstructionErrorCode } from "./events";

export interface StageCopy {
  /** Short label for the progress bar / status line. */
  label: string;
  /** One-line explanation of what is happening. */
  detail: string;
  /** True for stages that may legitimately take a long time (model work). */
  longRunning?: boolean;
}

export const STAGE_COPY: Record<ReconstructionStage, StageCopy> = {
  fetching_source: {
    label: "Fetching source",
    detail: "Downloading the page HTML and first-party scripts (never executed).",
  },
  parsing_dom: {
    label: "Parsing the DOM",
    detail: "Building a compact graph of UI elements and their relationships.",
  },
  caching_assets: {
    label: "Caching images",
    detail: "Storing page images locally so the 3D page can reuse them.",
  },
  designing: {
    label: "Designing in 3D",
    detail: "Grok is designing the page in three dimensions. This is the slow part.",
    longRunning: true,
  },
  rendering: {
    label: "Building the page",
    detail: "Streaming the design into the preview as it is written.",
    longRunning: true,
  },
  preparing_agent: {
    label: "Mapping elements",
    detail: "Preparing every recognized element as evidence for reconstruction.",
  },
  reconstructing: {
    label: "Reconstructing in 3D",
    detail: "Grok is mapping the page onto approved 3D components. This is the slow part.",
    longRunning: true,
  },
  validating_spec: {
    label: "Validating the result",
    detail: "Checking components, evidence links, hierarchy, and local assets.",
  },
  presenting_result: {
    label: "Generating components",
    detail: "Streaming reconstructed nodes into the preview.",
  },
  completed: {
    label: "Done",
    detail: "The 3D reconstruction is ready.",
  },
  failed: {
    label: "Failed",
    detail: "The conversion could not finish.",
  },
};

/** Ordered list used to draw the step tracker. Terminal stages are excluded. */
export const STAGE_ORDER: readonly ReconstructionStage[] = [
  "fetching_source",
  "parsing_dom",
  "caching_assets",
  "preparing_agent",
  "designing",
  "rendering",
];

export const ERROR_COPY: Record<string, string> = {
  INVALID_DESIGN:
    "The generated page could not be rendered. Trying again usually helps.",
  WORKFLOW_ABORTED: "The conversion was cancelled.",
  SOURCE_FETCH_FAILED:
    "We couldn't fetch that page. It may be blocked for automated clients, offline, or not an HTML page.",
  INVALID_RECONSTRUCTION:
    "The model produced a reconstruction that failed validation. Trying again usually helps.",
  MODEL_REQUEST_FAILED:
    "The reconstruction model request failed. Please try again in a moment.",
  MODEL_NOT_CONFIGURED:
    "The reconstruction model is not configured on this server (missing API key).",
  WORKFLOW_FAILED: "The conversion failed unexpectedly.",
};

export function describeError(code: ReconstructionErrorCode): string {
  return ERROR_COPY[code] ?? ERROR_COPY.WORKFLOW_FAILED;
}
