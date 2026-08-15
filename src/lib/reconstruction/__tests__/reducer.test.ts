import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateReconstructionSpec } from "../../../../backend/src/reconstruction/validate-reconstruction-spec";
import type { ReconstructionEvent } from "../events";
import { EMPTY_IMAGES_EVENTS } from "../fixtures/empty-images";
import { FAILURE_EVENTS, FAILURE_RETRYABLE_EVENTS } from "../fixtures/failure";
import { OUT_OF_ORDER_EVENTS, OUT_OF_ORDER_IGNORED_COUNT } from "../fixtures/out-of-order";
import { buildAcmeScenario, SUCCESS_EVENTS } from "../fixtures/success";
import {
  initialReconstructionState,
  reconstructionReducer,
  selectActiveJob,
  selectOrderedElements,
  selectOrderedNodes,
  type ReconstructionState,
} from "../reducer";

function applyAll(
  events: readonly ReconstructionEvent[],
  state: ReconstructionState = initialReconstructionState,
): ReconstructionState {
  return events.reduce(
    (current, event) => reconstructionReducer(current, { type: "job.event", event, at: 1_000 }),
    state,
  );
}

function withJobId(event: ReconstructionEvent, jobId: string): ReconstructionEvent {
  return { ...event, jobId };
}

const started = reconstructionReducer(initialReconstructionState, {
  type: "job.start",
  jobId: "job_fixture",
  sourceUrl: "https://docs.acme.example/",
  at: 500,
});

describe("reconstructionReducer", () => {
  it("keeps state isolated by jobId", () => {
    const first = SUCCESS_EVENTS.slice(0, 4);
    const other = first.map((event) => withJobId(event, "job_other"));
    let state = applyAll(first, started);
    state = applyAll(other, state);

    assert.deepEqual(Object.keys(state.jobs).sort(), ["job_fixture", "job_other"]);
    assert.equal(state.activeJobId, "job_fixture");
    assert.equal(state.jobs.job_fixture.lastSequence, 4);
    assert.equal(state.jobs.job_other.lastSequence, 4);
    assert.equal(state.jobs.job_fixture.sourceUrl, "https://docs.acme.example/");
    assert.equal(state.jobs.job_other.sourceUrl, null);
    assert.equal(state.jobs.job_fixture.counts.elements, 6);
    assert.equal(state.jobs.job_other.counts.elements, 6);
  });

  it("moves connecting → running/open on the first event", () => {
    const state = applyAll(SUCCESS_EVENTS.slice(0, 1), started);
    const job = selectActiveJob(state);
    assert.ok(job);
    assert.equal(job.status, "running");
    assert.equal(job.connection, "open");
    assert.equal(job.stage, "fetching_source");
    assert.equal(job.progress, 2);
    assert.equal(job.message, "Fetching webpage source.");
  });

  it("ignores duplicate and stale sequences and counts them", () => {
    const state = applyAll(OUT_OF_ORDER_EVENTS, started);
    const job = state.jobs.job_fixture;
    assert.equal(job.ignoredEvents, OUT_OF_ORDER_IGNORED_COUNT);
    assert.equal(job.status, "completed");
    assert.equal(job.progress, 100);

    const clean = applyAll(SUCCESS_EVENTS, started).jobs.job_fixture;
    assert.deepEqual(job.nodeOrder, clean.nodeOrder);
    assert.deepEqual(job.elementOrder, clean.elementOrder);
    assert.deepEqual(job.result, clean.result);
    assert.equal(job.lastSequence, clean.lastSequence);
  });

  it("upserts elements and nodes by id while preserving first-seen order", () => {
    const elementEvents = SUCCESS_EVENTS.filter((event) => event.type === "source.element");
    const nodeEvents = SUCCESS_EVENTS.filter((event) => event.type === "reconstruction.node");
    let state = applyAll([...elementEvents, ...nodeEvents], started);

    const beforeElements = selectOrderedElements(state.jobs.job_fixture).map((el) => el.id);
    const beforeNodes = selectOrderedNodes(state.jobs.job_fixture).map((node) => node.id);
    assert.equal(beforeElements.length, 6);
    assert.equal(beforeNodes.length, 8);

    // Re-deliver the first element and first node with new content and a newer sequence.
    const lastSequence = state.jobs.job_fixture.lastSequence;
    const firstElement = elementEvents[0];
    const firstNode = nodeEvents[0];
    assert.equal(firstElement.type, "source.element");
    assert.equal(firstNode.type, "reconstruction.node");
    const updates: ReconstructionEvent[] = [
      {
        ...firstElement,
        sequence: lastSequence + 1,
        element: { ...firstElement.element, name: "Acme Docs (updated)" },
      },
      {
        ...firstNode,
        sequence: lastSequence + 2,
        node: { ...firstNode.node, order: 42 },
      },
    ];
    state = applyAll(updates, state);
    const job = state.jobs.job_fixture;

    assert.deepEqual(selectOrderedElements(job).map((el) => el.id), beforeElements);
    assert.deepEqual(selectOrderedNodes(job).map((node) => node.id), beforeNodes);
    assert.equal(job.elements[firstElement.element.id].name, "Acme Docs (updated)");
    assert.equal(job.nodes[firstNode.node.id].order, 42);
    assert.deepEqual(job.focus?.reconstructionNodeIds, [firstNode.node.id]);
    assert.equal(job.focus?.sequence, lastSequence + 2);
    assert.equal(job.focus?.highlightColor, "#22c55e");
  });

  it("completes: replaces nodes with the validated result, progress 100, closed", () => {
    const state = applyAll(SUCCESS_EVENTS, started);
    const job = state.jobs.job_fixture;
    const scenario = buildAcmeScenario();

    assert.equal(job.status, "completed");
    assert.equal(job.connection, "closed");
    assert.equal(job.progress, 100);
    assert.equal(job.stage, "completed");
    assert.equal(job.focus, null);
    assert.equal(job.error, null);
    assert.equal(job.finishedAt, 1_000);
    assert.equal(job.completion?.model, "grok-4-fast-non-reasoning");
    assert.equal(job.completion?.usage?.totalTokens, 6040);
    assert.ok(job.result);
    assert.deepEqual(job.result, scenario.spec);
    assert.deepEqual(
      job.nodeOrder,
      scenario.spec.nodes.map((node) => node.id),
    );
    assert.deepEqual(selectOrderedNodes(job), scenario.spec.nodes);
    assert.deepEqual(job.counts, { elements: 6, connections: 3, images: 2, nodes: 8 });
  });

  it("streams the same nodes that appear in the completed result", () => {
    const streamed = SUCCESS_EVENTS.filter((event) => event.type === "reconstruction.node").map(
      (event) => (event.type === "reconstruction.node" ? event.node : null),
    );
    const completed = SUCCESS_EVENTS.at(-1);
    assert.equal(completed?.type, "workflow.completed");
    if (completed?.type === "workflow.completed") {
      assert.deepEqual(streamed, completed.result!.nodes);
    }
  });

  it("fixture specs pass the backend schema and reference validation", () => {
    for (const events of [SUCCESS_EVENTS, EMPTY_IMAGES_EVENTS]) {
      const completed = events.at(-1);
      assert.equal(completed?.type, "workflow.completed");
      if (completed?.type !== "workflow.completed") continue;
      const elementIds = events.flatMap((event) =>
        event.type === "source.element" ? [event.element.id] : [],
      );
      const assetIds = events.flatMap((event) =>
        event.type === "source.element" && event.element.assetId ? [event.element.assetId] : [],
      );
      const result = validateReconstructionSpec(completed.result, {
        elementIds,
        connectionIds: ["rel_0001", "rel_0002", "rel_0003"],
        assetIds,
        requireElementCoverage: true,
      });
      assert.deepEqual(result.valid ? [] : result.errors, []);
    }
  });

  it("empty-images fixture has no image element, no Image3D node, images count 0", () => {
    const state = applyAll(EMPTY_IMAGES_EVENTS, started);
    const job = state.jobs.job_fixture;
    assert.equal(job.counts.images, 0);
    assert.ok(selectOrderedElements(job).every((el) => !el.assetId));
    assert.ok(job.result?.nodes.every((node) => node.component !== "Image3D"));
    assert.equal(job.result?.nodes.length, 7);
  });

  it("ignores events after a terminal event", () => {
    const state = applyAll(SUCCESS_EVENTS, started);
    const before = state.jobs.job_fixture;
    const late: ReconstructionEvent = {
      ...SUCCESS_EVENTS[0],
      sequence: before.lastSequence + 5,
      progress: 3,
    };
    const after = applyAll([late], state).jobs.job_fixture;
    assert.equal(after.status, "completed");
    assert.equal(after.progress, 100);
    assert.equal(after.lastSequence, before.lastSequence);
    assert.equal(after.ignoredEvents, before.ignoredEvents + 1);
    assert.deepEqual(after.result, before.result);
  });

  it("fails: records the error and retryable flag, closes the connection", () => {
    const state = applyAll(FAILURE_EVENTS, started);
    const job = state.jobs.job_fixture;
    assert.equal(job.status, "failed");
    assert.equal(job.connection, "closed");
    assert.equal(job.stage, "failed");
    assert.deepEqual(job.error, {
      code: "SOURCE_FETCH_FAILED",
      message: "The webpage source could not be collected.",
      retryable: false,
    });

    const retryable = applyAll(FAILURE_RETRYABLE_EVENTS, started).jobs.job_fixture;
    assert.equal(retryable.status, "failed");
    assert.equal(retryable.error?.code, "MODEL_REQUEST_FAILED");
    assert.equal(retryable.error?.retryable, true);
    assert.equal(retryable.progress, 60);
    assert.equal(retryable.elementOrder.length, 6);
  });

  it("transportError keeps the last state and marks the connection disconnected", () => {
    const partial = applyAll(SUCCESS_EVENTS.slice(0, 10), started);
    const before = partial.jobs.job_fixture;
    const state = reconstructionReducer(partial, {
      type: "job.transportError",
      jobId: "job_fixture",
      message: "The mock connection dropped.",
    });
    const job = state.jobs.job_fixture;
    assert.equal(job.connection, "disconnected");
    assert.equal(job.transportError, "The mock connection dropped.");
    assert.equal(job.status, "running");
    assert.equal(job.stage, before.stage);
    assert.equal(job.progress, before.progress);
    assert.deepEqual(job.elementOrder, before.elementOrder);
    assert.equal(job.lastSequence, before.lastSequence);
  });

  it("clears the transport error when the stream resumes", () => {
    const partial = applyAll(SUCCESS_EVENTS.slice(0, 10), started);
    const dropped = reconstructionReducer(partial, {
      type: "job.transportError",
      jobId: "job_fixture",
      message: "dropped",
    });
    const resumed = applyAll(SUCCESS_EVENTS.slice(10, 11), dropped).jobs.job_fixture;
    assert.equal(resumed.transportError, null);
    assert.equal(resumed.connection, "disconnected");
  });

  it("transportError after a terminal event does not change status", () => {
    const completed = applyAll(SUCCESS_EVENTS, started);
    const state = reconstructionReducer(completed, {
      type: "job.transportError",
      jobId: "job_fixture",
      message: "late",
    });
    const job = state.jobs.job_fixture;
    assert.equal(job.status, "completed");
    assert.equal(job.connection, "closed");
    assert.equal(job.transportError, null);
    assert.equal(job.progress, 100);
  });

  it("job.connection never regresses a terminal job's status", () => {
    const completed = applyAll(SUCCESS_EVENTS, started);
    const state = reconstructionReducer(completed, {
      type: "job.connection",
      jobId: "job_fixture",
      connection: "disconnected",
    });
    assert.equal(state.jobs.job_fixture.status, "completed");
    assert.equal(state.jobs.job_fixture.connection, "disconnected");
  });

  it("dismiss removes the job and clears the active job", () => {
    const state = reconstructionReducer(applyAll(SUCCESS_EVENTS, started), {
      type: "job.dismiss",
      jobId: "job_fixture",
    });
    assert.deepEqual(state.jobs, {});
    assert.equal(state.activeJobId, null);
    assert.equal(selectActiveJob(state), null);
  });

  it("job.start for an existing id keeps existing state and only re-activates it", () => {
    const state = applyAll(SUCCESS_EVENTS.slice(0, 3), started);
    const restarted = reconstructionReducer(state, {
      type: "job.start",
      jobId: "job_fixture",
      sourceUrl: "https://other.example/",
    });
    assert.equal(restarted.jobs.job_fixture.lastSequence, 3);
    assert.equal(restarted.jobs.job_fixture.sourceUrl, "https://docs.acme.example/");
    assert.equal(restarted.activeJobId, "job_fixture");
  });
});
