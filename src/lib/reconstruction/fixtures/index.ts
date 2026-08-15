/**
 * Registry of deterministic event fixtures for development and tests.
 * Select one in the browser with `/?source=mock&fixture=<name>`.
 */
import type { MockEventSourceOptions } from "../event-source";
import type { ReconstructionEvent } from "../events";
import { EMPTY_IMAGES_EVENTS } from "./empty-images";
import { FAILURE_EVENTS, FAILURE_RETRYABLE_EVENTS } from "./failure";
import { LONG_MODEL_STAGE_EVENTS, LONG_MODEL_STAGE_OPTIONS } from "./long-model-stage";
import { OUT_OF_ORDER_EVENTS } from "./out-of-order";
import { RECONNECTION_EVENTS, RECONNECTION_OPTIONS } from "./reconnection";
import { SUCCESS_EVENTS } from "./success";

export const FIXTURE_NAMES = [
  "success",
  "failure",
  "failure-retryable",
  "out-of-order",
  "empty-images",
  "long-model-stage",
  "reconnection",
] as const;

export type FixtureName = (typeof FIXTURE_NAMES)[number];

export interface ReconstructionFixture {
  events: readonly ReconstructionEvent[];
  options?: MockEventSourceOptions;
}

export const FIXTURES: Record<FixtureName, ReconstructionFixture> = {
  success: { events: SUCCESS_EVENTS },
  failure: { events: FAILURE_EVENTS },
  "failure-retryable": { events: FAILURE_RETRYABLE_EVENTS },
  "out-of-order": { events: OUT_OF_ORDER_EVENTS },
  "empty-images": { events: EMPTY_IMAGES_EVENTS },
  "long-model-stage": { events: LONG_MODEL_STAGE_EVENTS, options: LONG_MODEL_STAGE_OPTIONS },
  reconnection: { events: RECONNECTION_EVENTS, options: RECONNECTION_OPTIONS },
};

export function isFixtureName(value: string | null | undefined): value is FixtureName {
  return typeof value === "string" && (FIXTURE_NAMES as readonly string[]).includes(value);
}
