/**
 * Injectable transport for reconstruction events.
 *
 * The UI only depends on `ReconstructionEventSource`. Two implementations ship:
 * - `createSseEventSource` — POSTs to `/api/reconstruct` (see openapi.yaml) and
 *   parses the Server-Sent Events stream with `fetch` + `ReadableStream`.
 * - `createMockEventSource` — replays deterministic fixtures for development,
 *   tests, and Storybook-style previews without touching the backend.
 */
import { isReconstructionEvent, isTerminalEvent, type ReconstructionEvent } from "./events";

export interface ReconstructionRequest {
  url: string;
  /** Client-chosen job ID (`job_` + 8–64 URL-safe chars). */
  jobId: string;
  /** Reserved for a future resumable transport. */
  afterSequence?: number;
}

export interface ReconstructionEventHandlers {
  onEvent(event: ReconstructionEvent): void;
  /** Called once the transport is established (first byte / first frame). */
  onOpen?(): void;
}

/**
 * Starts a job and streams its events until the terminal event, the stream
 * ends, or `signal` aborts. Resolves when the stream closes normally (whether
 * or not a terminal event was seen); rejects with `ReconstructionTransportError`
 * on transport-level failures. Aborts resolve quietly.
 */
export type ReconstructionEventSource = (
  request: ReconstructionRequest,
  handlers: ReconstructionEventHandlers,
  signal?: AbortSignal,
) => Promise<void>;

export class ReconstructionTransportError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(message: string, options: { status?: number; code?: string } = {}) {
    super(message);
    this.name = "ReconstructionTransportError";
    this.status = options.status;
    this.code = options.code;
  }
}

export function createJobId(): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `job_${random}`;
}

/* -------------------------------------------------------------------------- */
/* SSE parsing                                                                */
/* -------------------------------------------------------------------------- */

export interface SseFrame {
  id?: string;
  event?: string;
  data: string;
}

/**
 * Incremental Server-Sent Events parser. Feed decoded text chunks; frames are
 * returned as soon as their terminating blank line arrives. Comment lines
 * (`: ping`) are ignored per the SSE specification.
 */
export function createSseParser(): {
  push(chunk: string): SseFrame[];
  flush(): SseFrame[];
} {
  let buffer = "";
  let id: string | undefined;
  let event: string | undefined;
  let dataLines: string[] = [];

  function finishFrame(frames: SseFrame[]): void {
    if (dataLines.length > 0) {
      frames.push({ id, event, data: dataLines.join("\n") });
    }
    id = undefined;
    event = undefined;
    dataLines = [];
  }

  function consumeLine(line: string, frames: SseFrame[]): void {
    if (line === "") {
      finishFrame(frames);
      return;
    }
    if (line.startsWith(":")) return; // comment / keep-alive
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    switch (field) {
      case "id":
        id = value;
        break;
      case "event":
        event = value;
        break;
      case "data":
        dataLines.push(value);
        break;
      default:
        // `retry` and unknown fields are ignored.
        break;
    }
  }

  return {
    push(chunk) {
      buffer += chunk;
      const frames: SseFrame[] = [];
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        let line = buffer.slice(0, newline);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        buffer = buffer.slice(newline + 1);
        consumeLine(line, frames);
        newline = buffer.indexOf("\n");
      }
      return frames;
    },
    flush() {
      const frames: SseFrame[] = [];
      if (buffer.length > 0) {
        consumeLine(buffer.replace(/\r$/, ""), frames);
        buffer = "";
      }
      finishFrame(frames);
      return frames;
    },
  };
}

/** Parses one SSE frame's `data` into a validated event, or `null` when invalid. */
export function parseEventFrame(frame: SseFrame): ReconstructionEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(frame.data);
  } catch {
    return null;
  }
  return isReconstructionEvent(value) ? value : null;
}

/* -------------------------------------------------------------------------- */
/* Fetch + SSE transport                                                      */
/* -------------------------------------------------------------------------- */

export interface SseEventSourceOptions {
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

export function createSseEventSource(
  options: SseEventSourceOptions = {},
): ReconstructionEventSource {
  const endpoint = options.endpoint ?? "/api/reconstruct";

  return async (request, handlers, signal) => {
    const fetchImpl = options.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ url: request.url, jobId: request.jobId }),
        signal,
      });
    } catch (error) {
      if (isAbortError(error)) return;
      throw new ReconstructionTransportError(
        error instanceof Error ? error.message : "The conversion request failed.",
      );
    }

    if (!response.ok) {
      throw new ReconstructionTransportError(
        await readErrorMessage(response),
        { status: response.status, code: await readErrorCode(response) },
      );
    }
    if (!response.body) {
      throw new ReconstructionTransportError("The conversion stream is empty.", {
        status: response.status,
      });
    }

    handlers.onOpen?.();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parser = createSseParser();

    const dispatch = (frames: SseFrame[]): boolean => {
      for (const frame of frames) {
        const event = parseEventFrame(frame);
        if (!event) continue;
        handlers.onEvent(event);
        if (isTerminalEvent(event)) return true;
      }
      return false;
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (dispatch(parser.push(decoder.decode(value, { stream: true })))) {
          await reader.cancel().catch(() => undefined);
          return;
        }
      }
      dispatch(parser.push(decoder.decode()));
      dispatch(parser.flush());
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) return;
      throw new ReconstructionTransportError(
        error instanceof Error ? error.message : "The conversion stream was interrupted.",
      );
    }
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function readErrorMessage(response: Response): Promise<string> {
  const fallback = `The conversion request failed (${response.status}).`;
  try {
    const cloned = response.clone();
    const body = (await cloned.json()) as { error?: { message?: unknown } };
    return typeof body?.error?.message === "string" ? body.error.message : fallback;
  } catch {
    return fallback;
  }
}

async function readErrorCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown } };
    return typeof body?.error?.code === "string" ? body.error.code : undefined;
  } catch {
    return undefined;
  }
}

/* -------------------------------------------------------------------------- */
/* Mock transport                                                             */
/* -------------------------------------------------------------------------- */

export interface MockEventSourceOptions {
  /** Delay between events in milliseconds (default 120). */
  intervalMs?: number;
  /** Optional per-event delay override, e.g. to simulate a long model stage. */
  delayFor?: (event: ReconstructionEvent, index: number) => number;
  /** When set, the transport rejects after this many events (simulated disconnect). */
  disconnectAfter?: number;
  /** Timer implementation (injectable for tests). */
  setTimeoutImpl?: typeof setTimeout;
}

/**
 * Replays a fixture as if it were streamed. The fixture events are rewritten to
 * the requested `jobId` so reducer isolation behaves exactly like production.
 */
export function createMockEventSource(
  fixture: readonly ReconstructionEvent[] | ((request: ReconstructionRequest) => readonly ReconstructionEvent[]),
  options: MockEventSourceOptions = {},
): ReconstructionEventSource {
  const intervalMs = options.intervalMs ?? 120;
  const wait = (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve) => {
      const timer = (options.setTimeoutImpl ?? setTimeout)(resolve, ms);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });

  return async (request, handlers, signal) => {
    const events = typeof fixture === "function" ? fixture(request) : fixture;
    handlers.onOpen?.();
    for (let index = 0; index < events.length; index += 1) {
      if (signal?.aborted) return;
      if (options.disconnectAfter !== undefined && index >= options.disconnectAfter) {
        throw new ReconstructionTransportError("The mock connection dropped.");
      }
      const event = { ...events[index], jobId: request.jobId };
      const delay = options.delayFor ? options.delayFor(event, index) : intervalMs;
      if (delay > 0) await wait(delay, signal);
      if (signal?.aborted) return;
      handlers.onEvent(event);
      if (isTerminalEvent(event)) return;
    }
  };
}
