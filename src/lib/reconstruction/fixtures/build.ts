/**
 * Small deterministic builder shared by every fixture so envelopes stay
 * consistent: fixed job ID, monotonically increasing `sequence`, and ISO
 * `emittedAt` timestamps spaced evenly from a fixed start instant.
 */
import type { ReconstructionEventInput } from "../../../../backend/src/workflow/reconstruction-events";
import type { ReconstructionEvent, ReconstructionStage } from "../events";
import { RECONSTRUCTION_EVENT_VERSION } from "../events";

export const FIXTURE_JOB_ID = "job_fixture";
export const FIXTURE_START_MS = Date.parse("2026-01-15T10:00:00.000Z");
export const FIXTURE_STEP_MS = 400;

export interface FixtureBuilder {
  /** Appends the envelope (version, job ID, next sequence, timestamp). */
  emit(stage: ReconstructionStage, progress: number, input: ReconstructionEventInput): ReconstructionEvent;
  /** Sequence of the most recently emitted event. */
  readonly sequence: number;
}

export function createFixtureBuilder(
  options: { jobId?: string; startMs?: number; stepMs?: number; startSequence?: number } = {},
): FixtureBuilder {
  const jobId = options.jobId ?? FIXTURE_JOB_ID;
  const startMs = options.startMs ?? FIXTURE_START_MS;
  const stepMs = options.stepMs ?? FIXTURE_STEP_MS;
  let sequence = options.startSequence ?? 0;

  return {
    emit(stage, progress, input) {
      sequence += 1;
      return {
        eventVersion: RECONSTRUCTION_EVENT_VERSION,
        jobId,
        sequence,
        emittedAt: new Date(startMs + sequence * stepMs).toISOString(),
        stage,
        progress,
        ...input,
      } as ReconstructionEvent;
    },
    get sequence() {
      return sequence;
    },
  };
}

/** Mirrors the backend's per-item progress spread. */
export function itemProgress(index: number, total: number, span: number): number {
  return total > 0 ? Math.round(((index + 1) / total) * span) : span;
}
