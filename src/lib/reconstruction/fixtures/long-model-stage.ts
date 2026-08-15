/**
 * The success run replayed with a long pause in the `reconstructing` stage,
 * simulating a slow model response (~6 s between "reconstructing started" and
 * "reconstructing completed").
 */
import type { MockEventSourceOptions } from "../event-source";
import type { ReconstructionEvent } from "../events";
import { SUCCESS_EVENTS, SUCCESS_MODEL_RESPONSE_INDEX } from "./success";

export const LONG_MODEL_STAGE_EVENTS: readonly ReconstructionEvent[] = SUCCESS_EVENTS;

export const LONG_MODEL_STAGE_DELAY_MS = 6_000;
export const LONG_MODEL_STAGE_INTERVAL_MS = 160;

/** Per-event delay: a long wait before the model "responds", short otherwise. */
export const longModelStageDelayFor: NonNullable<MockEventSourceOptions["delayFor"]> = (
  _event,
  index,
) => (index === SUCCESS_MODEL_RESPONSE_INDEX ? LONG_MODEL_STAGE_DELAY_MS : LONG_MODEL_STAGE_INTERVAL_MS);

export const LONG_MODEL_STAGE_OPTIONS: MockEventSourceOptions = {
  intervalMs: LONG_MODEL_STAGE_INTERVAL_MS,
  delayFor: longModelStageDelayFor,
};
