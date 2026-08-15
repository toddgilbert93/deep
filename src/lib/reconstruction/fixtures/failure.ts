/**
 * Failure fixtures.
 *
 * - `FAILURE_EVENTS`: the source could not be fetched (not retryable).
 * - `FAILURE_RETRYABLE_EVENTS`: the model request failed after the
 *   reconstructing stage began (retryable).
 */
import type { ReconstructionEvent } from "../events";
import { createFixtureBuilder } from "./build";
import { SUCCESS_EVENTS } from "./success";

function buildFetchFailure(): ReconstructionEvent[] {
  const build = createFixtureBuilder();
  return [
    build.emit("fetching_source", 2, {
      type: "workflow.status",
      status: "started",
      message: "Fetching webpage source.",
    }),
    build.emit("failed", 2, {
      type: "workflow.failed",
      status: "failed",
      message: "The webpage source could not be collected.",
      error: { code: "SOURCE_FETCH_FAILED", retryable: false },
    }),
  ];
}

function buildModelFailure(): ReconstructionEvent[] {
  const startIndex = SUCCESS_EVENTS.findIndex(
    (event) => event.stage === "reconstructing" && event.type === "workflow.status" && event.status === "started",
  );
  const prefix = SUCCESS_EVENTS.slice(0, startIndex + 1);
  const last = prefix[prefix.length - 1];
  // Continue the sequence after the prefix so ordering stays monotonic.
  const build = createFixtureBuilder({ startSequence: last.sequence });
  return [
    ...prefix,
    build.emit("failed", last.progress, {
      type: "workflow.failed",
      status: "failed",
      message: "The reconstruction model request failed.",
      error: { code: "MODEL_REQUEST_FAILED", retryable: true },
    }),
  ];
}

export const FAILURE_EVENTS: readonly ReconstructionEvent[] = buildFetchFailure();
export const FAILURE_RETRYABLE_EVENTS: readonly ReconstructionEvent[] = buildModelFailure();
