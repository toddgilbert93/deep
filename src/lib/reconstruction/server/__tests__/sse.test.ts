import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createSseParser, parseEventFrame } from "../../event-source";
import type { ReconstructionEvent, ReconstructionFailedEvent, ReconstructionStatusEvent } from "../../events";
import { formatSseFrame, SSE_KEEPALIVE_FRAME, validateReconstructRequest } from "../sse";

const statusEvent: ReconstructionStatusEvent = {
  eventVersion: "1.0",
  jobId: "job_test-1234",
  sequence: 1,
  emittedAt: "2026-08-15T12:00:00.000Z",
  stage: "fetching_source",
  progress: 2,
  type: "workflow.status",
  status: "started",
  message: "Fetching webpage source.",
};

const failedEvent: ReconstructionFailedEvent = {
  eventVersion: "1.0",
  jobId: "job_test-1234",
  sequence: 2,
  emittedAt: "2026-08-15T12:00:01.000Z",
  stage: "failed",
  progress: 2,
  type: "workflow.failed",
  status: "failed",
  message: "The webpage source could not be collected.\nSecond line.",
  error: { code: "SOURCE_FETCH_FAILED", retryable: false },
};

describe("formatSseFrame", () => {
  it("emits id, event, and data lines terminated by a blank line", () => {
    const frame = formatSseFrame(statusEvent);
    assert.equal(
      frame,
      `id: 1\nevent: workflow.status\ndata: ${JSON.stringify(statusEvent)}\n\n`,
    );
  });

  it("round-trips through the client SSE parser", () => {
    const parser = createSseParser();
    const frames = parser.push(formatSseFrame(statusEvent) + formatSseFrame(failedEvent));
    assert.equal(frames.length, 2);
    assert.equal(frames[0].id, "1");
    assert.equal(frames[0].event, "workflow.status");
    assert.deepEqual(parseEventFrame(frames[0]), statusEvent);
    assert.equal(frames[1].id, "2");
    assert.equal(frames[1].event, "workflow.failed");
    assert.deepEqual(parseEventFrame(frames[1]), failedEvent);
  });

  it("survives chunked delivery interleaved with keep-alive comments", () => {
    const wire = SSE_KEEPALIVE_FRAME + formatSseFrame(statusEvent) + SSE_KEEPALIVE_FRAME;
    const parser = createSseParser();
    const received: ReconstructionEvent[] = [];
    for (let index = 0; index < wire.length; index += 7) {
      for (const frame of parser.push(wire.slice(index, index + 7))) {
        const event = parseEventFrame(frame);
        if (event) received.push(event);
      }
    }
    for (const frame of parser.flush()) {
      const event = parseEventFrame(frame);
      if (event) received.push(event);
    }
    assert.deepEqual(received, [statusEvent]);
  });

  it("keeps newline characters inside messages JSON-escaped on a single data line", () => {
    const withNewline = { ...statusEvent, message: "line one\nline two\r\nline three" };
    const frame = formatSseFrame(withNewline);
    // JSON.stringify escapes control characters, so exactly one data line and
    // exactly one terminating blank line are produced.
    assert.equal(frame.split("data: ").length - 1, 1);
    assert.equal(frame.indexOf("\n\n"), frame.length - 2);
    const frames = createSseParser().push(frame);
    assert.equal(frames.length, 1);
    assert.deepEqual(parseEventFrame(frames[0]), withNewline);
  });

  it("keep-alive frame is an SSE comment ignored by the parser", () => {
    assert.equal(SSE_KEEPALIVE_FRAME, ": ping\n\n");
    assert.deepEqual(createSseParser().push(SSE_KEEPALIVE_FRAME), []);
  });
});

describe("validateReconstructRequest", () => {
  it("accepts an absolute https URL and normalizes it", () => {
    const result = validateReconstructRequest({ url: "https://Example.com" });
    assert.deepEqual(result, { ok: true, url: "https://example.com/" });
  });

  it("accepts an http URL with a valid jobId", () => {
    const result = validateReconstructRequest({
      url: "http://example.com/path?q=1",
      jobId: "job_abcdef12-3456",
    });
    assert.deepEqual(result, {
      ok: true,
      url: "http://example.com/path?q=1",
      jobId: "job_abcdef12-3456",
    });
  });

  it("rejects a missing body or non-object body", () => {
    for (const body of [undefined, null, "https://example.com", 42, ["https://example.com"]]) {
      const result = validateReconstructRequest(body);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "INVALID_REQUEST");
    }
  });

  it("rejects a missing or empty url", () => {
    for (const body of [{}, { url: "" }, { url: "   " }, { url: 12 }, { url: null }]) {
      const result = validateReconstructRequest(body);
      assert.equal(result.ok, false);
    }
  });

  it("rejects relative and non-http schemes", () => {
    for (const url of ["/relative", "example.com", "ftp://x", "file:///etc/passwd", "javascript:alert(1)", "data:text/html,hi"]) {
      const result = validateReconstructRequest({ url });
      assert.equal(result.ok, false, `expected ${url} to be rejected`);
      if (!result.ok) assert.equal(result.code, "INVALID_REQUEST");
    }
  });

  it("rejects URLs with embedded credentials", () => {
    for (const url of ["https://user:pass@example.com/", "https://user@example.com/"]) {
      const result = validateReconstructRequest({ url });
      assert.equal(result.ok, false, `expected ${url} to be rejected`);
      if (!result.ok) assert.match(result.message, /credentials/);
    }
  });

  it("rejects malformed jobIds", () => {
    for (const jobId of ["job_short", "nope_abcdefgh", "job_" + "a".repeat(65), "job_with space", 123, null]) {
      const result = validateReconstructRequest({ url: "https://example.com", jobId });
      assert.equal(result.ok, false, `expected jobId ${String(jobId)} to be rejected`);
      if (!result.ok) assert.match(result.message, /jobId/);
    }
  });
});
