import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createJobId,
  createMockEventSource,
  createSseEventSource,
  createSseParser,
  parseEventFrame,
  ReconstructionTransportError,
} from "../event-source";
import type { ReconstructionEvent } from "../events";
import { FAILURE_EVENTS } from "../fixtures/failure";
import { SUCCESS_EVENTS } from "../fixtures/success";

function frameFor(event: ReconstructionEvent): string {
  return `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function fakeFetch(
  response: () => Response,
  calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [],
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    return response();
  }) as typeof fetch;
}

describe("createJobId", () => {
  it("produces a job_ prefixed URL-safe id", () => {
    const id = createJobId();
    assert.match(id, /^job_[A-Za-z0-9_-]{8,64}$/);
    assert.notEqual(id, createJobId());
  });
});

describe("createSseParser", () => {
  it("assembles frames split across chunks", () => {
    const parser = createSseParser();
    const first = parser.push('id: 1\nevent: workflow.status\nda');
    assert.deepEqual(first, []);
    const second = parser.push('ta: {"a":1}\n\nid: 2\ndata: {"b":');
    assert.deepEqual(second, [{ id: "1", event: "workflow.status", data: '{"a":1}' }]);
    const third = parser.push("2}\n\n");
    assert.deepEqual(third, [{ id: "2", event: undefined, data: '{"b":2}' }]);
  });

  it("handles CRLF line endings", () => {
    const parser = createSseParser();
    const frames = parser.push('id: 7\r\nevent: x\r\ndata: {"ok":true}\r\n\r\n');
    assert.deepEqual(frames, [{ id: "7", event: "x", data: '{"ok":true}' }]);
  });

  it("ignores comment / keep-alive lines and unknown fields", () => {
    const parser = createSseParser();
    const frames = parser.push(': ping\n\nretry: 1000\n: another\ndata: hello\n\n');
    assert.deepEqual(frames, [{ id: undefined, event: undefined, data: "hello" }]);
  });

  it("joins multi-line data with newlines and strips one leading space", () => {
    const parser = createSseParser();
    const frames = parser.push("data: line one\ndata:line two\ndata:  spaced\n\n");
    assert.deepEqual(frames, [{ id: undefined, event: undefined, data: "line one\nline two\n spaced" }]);
  });

  it("flushes a trailing frame without a terminating blank line", () => {
    const parser = createSseParser();
    assert.deepEqual(parser.push("id: 3\ndata: tail"), []);
    assert.deepEqual(parser.flush(), [{ id: "3", event: undefined, data: "tail" }]);
    assert.deepEqual(parser.flush(), []);
  });
});

describe("parseEventFrame", () => {
  it("returns validated events", () => {
    const event = SUCCESS_EVENTS[0];
    const parsed = parseEventFrame({ id: "1", event: event.type, data: JSON.stringify(event) });
    assert.deepEqual(parsed, event);
  });

  it("rejects invalid JSON, wrong versions, and unknown types", () => {
    assert.equal(parseEventFrame({ data: "{not json" }), null);
    const event = SUCCESS_EVENTS[0];
    assert.equal(parseEventFrame({ data: JSON.stringify({ ...event, eventVersion: "2.0" }) }), null);
    assert.equal(parseEventFrame({ data: JSON.stringify({ ...event, type: "workflow.other" }) }), null);
    assert.equal(parseEventFrame({ data: JSON.stringify({ ...event, sequence: 0 }) }), null);
    assert.equal(parseEventFrame({ data: JSON.stringify({ ...event, stage: "nope" }) }), null);
    assert.equal(parseEventFrame({ data: JSON.stringify({ ...event, progress: 101 }) }), null);
    assert.equal(parseEventFrame({ data: JSON.stringify({ ...event, jobId: "" }) }), null);
  });
});

describe("createSseEventSource", () => {
  it("POSTs the request and dispatches parsed events in order", async () => {
    const events = SUCCESS_EVENTS.slice(0, 5);
    const text = events.map(frameFor).join("");
    // Split into awkward chunks to exercise the incremental parser.
    const chunks = [": ping\n\n", text.slice(0, 40), text.slice(40, 41), text.slice(41)];
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const source = createSseEventSource({
      endpoint: "/api/reconstruct",
      fetchImpl: fakeFetch(
        () =>
          new Response(streamOf(chunks), {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          }),
        calls,
      ),
    });

    const received: ReconstructionEvent[] = [];
    let opened = 0;
    await source(
      { url: "https://docs.acme.example/", jobId: "job_test" },
      { onEvent: (event) => received.push(event), onOpen: () => (opened += 1) },
    );

    assert.equal(opened, 1);
    assert.deepEqual(received, events);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].input, "/api/reconstruct");
    assert.equal(calls[0].init?.method, "POST");
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
      url: "https://docs.acme.example/",
      jobId: "job_test",
    });
    const headers = calls[0].init?.headers as Record<string, string>;
    assert.equal(headers.Accept, "text/event-stream");
  });

  it("stops reading after the terminal event", async () => {
    const terminal = FAILURE_EVENTS;
    const extra: ReconstructionEvent = { ...SUCCESS_EVENTS[2], sequence: 99 };
    const chunks = [...terminal.map(frameFor), frameFor(extra)];
    const source = createSseEventSource({
      fetchImpl: fakeFetch(() => new Response(streamOf(chunks), { status: 200 })),
    });
    const received: ReconstructionEvent[] = [];
    await source({ url: "https://x.example/", jobId: "job_t" }, { onEvent: (e) => received.push(e) });
    assert.deepEqual(
      received.map((event) => event.type),
      ["workflow.status", "workflow.failed"],
    );
  });

  it("skips invalid frames but keeps valid ones", async () => {
    const chunks = ['data: {"garbage":true}\n\n', frameFor(SUCCESS_EVENTS[0]), "data: nope\n\n"];
    const source = createSseEventSource({
      fetchImpl: fakeFetch(() => new Response(streamOf(chunks), { status: 200 })),
    });
    const received: ReconstructionEvent[] = [];
    await source({ url: "https://x.example/", jobId: "job_t" }, { onEvent: (e) => received.push(e) });
    assert.deepEqual(received, [SUCCESS_EVENTS[0]]);
  });

  it("rejects with ReconstructionTransportError including status and code on non-200", async () => {
    const source = createSseEventSource({
      fetchImpl: fakeFetch(
        () =>
          new Response(
            JSON.stringify({ error: { code: "MODEL_NOT_CONFIGURED", message: "Missing key." } }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          ),
      ),
    });
    await assert.rejects(
      source({ url: "https://x.example/", jobId: "job_t" }, { onEvent: () => undefined }),
      (error: unknown) => {
        assert.ok(error instanceof ReconstructionTransportError);
        assert.equal(error.status, 503);
        assert.equal(error.code, "MODEL_NOT_CONFIGURED");
        assert.equal(error.message, "Missing key.");
        return true;
      },
    );
  });

  it("falls back to a generic message for non-JSON error bodies", async () => {
    const source = createSseEventSource({
      fetchImpl: fakeFetch(() => new Response("Bad Gateway", { status: 502 })),
    });
    await assert.rejects(
      source({ url: "https://x.example/", jobId: "job_t" }, { onEvent: () => undefined }),
      (error: unknown) => {
        assert.ok(error instanceof ReconstructionTransportError);
        assert.equal(error.status, 502);
        assert.equal(error.code, undefined);
        assert.equal(error.message, "The conversion request failed (502).");
        return true;
      },
    );
  });

  it("wraps network failures as ReconstructionTransportError", async () => {
    const source = createSseEventSource({
      fetchImpl: (async () => {
        throw new TypeError("Failed to fetch");
      }) as typeof fetch,
    });
    await assert.rejects(
      source({ url: "https://x.example/", jobId: "job_t" }, { onEvent: () => undefined }),
      (error: unknown) =>
        error instanceof ReconstructionTransportError && error.message === "Failed to fetch",
    );
  });

  it("resolves quietly when aborted before the response arrives", async () => {
    const controller = new AbortController();
    const source = createSseEventSource({
      fetchImpl: ((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        })) as typeof fetch,
    });
    const run = source(
      { url: "https://x.example/", jobId: "job_t" },
      { onEvent: () => assert.fail("no events expected") },
      controller.signal,
    );
    controller.abort();
    await run;
  });
});

describe("createMockEventSource", () => {
  it("replays the fixture with the requested jobId and calls onOpen first", async () => {
    const source = createMockEventSource(SUCCESS_EVENTS.slice(0, 6), { intervalMs: 0 });
    const order: string[] = [];
    const received: ReconstructionEvent[] = [];
    await source(
      { url: "https://x.example/", jobId: "job_rewritten" },
      {
        onOpen: () => order.push("open"),
        onEvent: (event) => {
          order.push("event");
          received.push(event);
        },
      },
    );
    assert.equal(order[0], "open");
    assert.equal(received.length, 6);
    assert.ok(received.every((event) => event.jobId === "job_rewritten"));
    assert.deepEqual(
      received.map((event) => event.sequence),
      [1, 2, 3, 4, 5, 6],
    );
  });

  it("stops after the terminal event", async () => {
    const withExtra = [...FAILURE_EVENTS, { ...SUCCESS_EVENTS[2], sequence: 50 }];
    const source = createMockEventSource(withExtra, { intervalMs: 0 });
    const received: ReconstructionEvent[] = [];
    await source({ url: "https://x.example/", jobId: "job_t" }, { onEvent: (e) => received.push(e) });
    assert.equal(received.length, 2);
    assert.equal(received[1].type, "workflow.failed");
  });

  it("honours abort mid-replay", async () => {
    const controller = new AbortController();
    const source = createMockEventSource(SUCCESS_EVENTS, { intervalMs: 5 });
    const received: ReconstructionEvent[] = [];
    const run = source(
      { url: "https://x.example/", jobId: "job_t" },
      {
        onEvent: (event) => {
          received.push(event);
          if (received.length === 3) controller.abort();
        },
      },
      controller.signal,
    );
    await run;
    assert.equal(received.length, 3);
  });

  it("simulates a disconnect after N events", async () => {
    const source = createMockEventSource(SUCCESS_EVENTS, { intervalMs: 0, disconnectAfter: 4 });
    const received: ReconstructionEvent[] = [];
    await assert.rejects(
      source({ url: "https://x.example/", jobId: "job_t" }, { onEvent: (e) => received.push(e) }),
      ReconstructionTransportError,
    );
    assert.equal(received.length, 4);
  });

  it("supports a fixture factory and per-event delays", async () => {
    const delays: number[] = [];
    const source = createMockEventSource((request) => SUCCESS_EVENTS.slice(0, 3).map((e) => ({ ...e, jobId: request.jobId })), {
      delayFor: (_event, index) => {
        delays.push(index);
        return 0;
      },
    });
    const received: ReconstructionEvent[] = [];
    await source({ url: "https://x.example/", jobId: "job_factory" }, { onEvent: (e) => received.push(e) });
    assert.deepEqual(delays, [0, 1, 2]);
    assert.equal(received.length, 3);
  });
});
