/**
 * The success run with a simulated mid-stream disconnect. The mock transport
 * rejects after `RECONNECTION_DISCONNECT_AFTER` events (in the middle of the
 * source-element stream), so the UI must keep the last received state and
 * offer a retry.
 */
import type { MockEventSourceOptions } from "../event-source";
import type { ReconstructionEvent } from "../events";
import { SUCCESS_EVENTS } from "./success";

export const RECONNECTION_EVENTS: readonly ReconstructionEvent[] = SUCCESS_EVENTS;

/** Drop the connection after the 10th event (three source elements received). */
export const RECONNECTION_DISCONNECT_AFTER = 10;

export const RECONNECTION_OPTIONS: MockEventSourceOptions = {
  disconnectAfter: RECONNECTION_DISCONNECT_AFTER,
};
