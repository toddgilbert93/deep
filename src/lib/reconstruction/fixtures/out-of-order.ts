/**
 * The success run with delivery problems the reducer must absorb:
 * - sequence 3 is delivered twice (duplicate),
 * - events 7 and 8 arrive swapped (7 becomes stale and is ignored),
 * - a stale node event arrives after `workflow.completed`.
 *
 * Applying this fixture must produce the same final result as `SUCCESS_EVENTS`
 * with `ignoredEvents === 3`.
 */
import type { ReconstructionEvent } from "../events";
import { SUCCESS_EVENTS } from "./success";

function buildOutOfOrder(): ReconstructionEvent[] {
  const bySequence = (sequence: number): ReconstructionEvent => {
    const event = SUCCESS_EVENTS.find((candidate) => candidate.sequence === sequence);
    if (!event) throw new Error(`Success fixture has no event with sequence ${sequence}.`);
    return event;
  };

  const events: ReconstructionEvent[] = [];
  for (const event of SUCCESS_EVENTS) {
    if (event.sequence === 7) {
      // Deliver 8 first, then the (now stale) 7.
      events.push(bySequence(8), bySequence(7));
      continue;
    }
    if (event.sequence === 8) continue; // already delivered above
    events.push(event);
    if (event.sequence === 4) {
      // Duplicate delivery of sequence 3, arriving late.
      events.push({ ...bySequence(3) });
    }
  }
  // A stale node event after the terminal event.
  events.push({ ...bySequence(20) });
  return events;
}

export const OUT_OF_ORDER_EVENTS: readonly ReconstructionEvent[] = buildOutOfOrder();

/** Number of events the reducer is expected to ignore for this fixture. */
export const OUT_OF_ORDER_IGNORED_COUNT = 3;
