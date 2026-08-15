/**
 * React binding for the reconstruction reducer + injectable event source.
 *
 * The hook owns the AbortController for the in-flight transport, isolates
 * dispatches by job ID, and maps transport outcomes onto reducer actions:
 * - stream resolves without a terminal event → connection closed + transport error
 * - stream rejects with `ReconstructionTransportError` → transport error
 * - abort (cancel / unmount) → nothing is dispatched
 */
import { useCallback, useEffect, useReducer, useRef } from "react";

import {
  createJobId,
  ReconstructionTransportError,
  type ReconstructionEventSource,
} from "./event-source";
import { isTerminalEvent } from "./events";
import {
  initialReconstructionState,
  reconstructionReducer,
  selectActiveJob,
  type ReconstructionJobState,
  type ReconstructionState,
} from "./reducer";
import { describeError } from "./stage-copy";

export const STREAM_ENDED_EARLY_MESSAGE = "The stream ended before the conversion finished.";
export const CONNECTION_FAILED_MESSAGE = "The connection to the conversion service failed.";

export interface UseReconstructionOptions {
  eventSource: ReconstructionEventSource;
}

export interface UseReconstructionResult {
  state: ReconstructionState;
  activeJob: ReconstructionJobState | null;
  /** True while the active job is connecting or running with a live transport. */
  isRunning: boolean;
  /** Starts a new job for `url` and returns its job ID. */
  start(url: string): string;
  /** Aborts the in-flight transport and removes the active job. */
  cancel(): void;
  /** Starts a fresh job (new job ID) for the active job's URL. */
  retry(): void;
  /** Removes the active job from state (aborting it if still in flight). */
  dismiss(): void;
}

export function describeTransportError(error: unknown): string {
  if (error instanceof ReconstructionTransportError) {
    if (error.code) return describeError(error.code);
    if (error.status === 400) return "The conversion service rejected that URL.";
    return error.message || CONNECTION_FAILED_MESSAGE;
  }
  if (error instanceof Error && error.message) return error.message;
  return CONNECTION_FAILED_MESSAGE;
}

export function useReconstruction({ eventSource }: UseReconstructionOptions): UseReconstructionResult {
  const [state, dispatch] = useReducer(reconstructionReducer, initialReconstructionState);
  const controllerRef = useRef<AbortController | null>(null);
  const activeJobIdRef = useRef<string | null>(null);
  const eventSourceRef = useRef(eventSource);

  useEffect(() => {
    eventSourceRef.current = eventSource;
  }, [eventSource]);

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);

  const abortInFlight = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const start = useCallback((url: string): string => {
    abortInFlight();

    const jobId = createJobId();
    const controller = new AbortController();
    controllerRef.current = controller;
    activeJobIdRef.current = jobId;
    dispatch({ type: "job.start", jobId, sourceUrl: url, at: Date.now() });

    let sawTerminal = false;
    const isLive = () => !controller.signal.aborted;

    const run = eventSourceRef.current(
      { url, jobId },
      {
        onEvent: (event) => {
          if (!isLive() || event.jobId !== jobId) return;
          if (isTerminalEvent(event)) sawTerminal = true;
          dispatch({ type: "job.event", event, at: Date.now() });
        },
        onOpen: () => {
          if (!isLive()) return;
          dispatch({ type: "job.connection", jobId, connection: "open" });
        },
      },
      controller.signal,
    );

    run.then(
      () => {
        if (!isLive()) return;
        dispatch({ type: "job.connection", jobId, connection: "closed" });
        if (!sawTerminal) {
          dispatch({
            type: "job.transportError",
            jobId,
            message: STREAM_ENDED_EARLY_MESSAGE,
            at: Date.now(),
          });
        }
        if (controllerRef.current === controller) controllerRef.current = null;
      },
      (error: unknown) => {
        if (!isLive()) return;
        dispatch({
          type: "job.transportError",
          jobId,
          message: describeTransportError(error),
          at: Date.now(),
        });
        if (controllerRef.current === controller) controllerRef.current = null;
      },
    );

    return jobId;
  }, [abortInFlight]);

  const dismiss = useCallback(() => {
    abortInFlight();
    const jobId = activeJobIdRef.current;
    if (!jobId) return;
    activeJobIdRef.current = null;
    dispatch({ type: "job.dismiss", jobId });
  }, [abortInFlight]);

  const cancel = useCallback(() => {
    dismiss();
  }, [dismiss]);

  const activeJob = selectActiveJob(state);
  const activeUrl = activeJob?.sourceUrl ?? null;

  const retry = useCallback(() => {
    if (!activeUrl) return;
    dismiss();
    start(activeUrl);
  }, [activeUrl, dismiss, start]);

  const isRunning =
    activeJob !== null &&
    (activeJob.status === "connecting" || activeJob.status === "running") &&
    activeJob.connection !== "disconnected";

  return { state, activeJob, isRunning, start, cancel, retry, dismiss };
}
