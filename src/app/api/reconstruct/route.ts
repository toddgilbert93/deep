/**
 * `POST /api/reconstruct` — starts one webpage-to-3D conversion job and streams
 * its workflow events as Server-Sent Events. See `openapi.yaml`.
 *
 * The handler is a thin transport around `designWebpage`; it never enables
 * private-network access for user-submitted URLs and never forwards raw model
 * output. All events on the wire are the validated backend event objects.
 */
import { designWebpage } from "../../../../backend/src/workflow/design-webpage";
import type { ReconstructionEvent } from "../../../lib/reconstruction/events";
import {
  formatSseFrame,
  SSE_KEEPALIVE_FRAME,
  validateReconstructRequest,
} from "../../../lib/reconstruction/server/sse";

/** Reconstruction can take several minutes on large pages; allow a long-lived stream. */
export const maxDuration = 300;

const KEEPALIVE_INTERVAL_MS = 15_000;

function jsonError(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "INVALID_REQUEST", "The request body must be valid JSON.");
  }

  const validation = validateReconstructRequest(body);
  if (!validation.ok) {
    return jsonError(400, validation.code, validation.message);
  }

  if (!process.env.XAI_API_KEY?.trim()) {
    return jsonError(
      503,
      "MODEL_NOT_CONFIGURED",
      "XAI_API_KEY is not configured on the server.",
    );
  }

  const { url, jobId } = validation;
  const encoder = new TextEncoder();
  const abortController = new AbortController();
  let keepAlive: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (text: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // The client disconnected and the controller is already closed.
          closed = true;
          abortController.abort();
        }
      };

      const finish = (): void => {
        if (keepAlive !== undefined) {
          clearInterval(keepAlive);
          keepAlive = undefined;
        }
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed by the client or by cancel().
        }
      };

      const onClientAbort = (): void => {
        abortController.abort();
        finish();
      };
      if (request.signal.aborted) {
        onClientAbort();
        return;
      }
      request.signal.addEventListener("abort", onClientAbort, { once: true });

      keepAlive = setInterval(() => write(SSE_KEEPALIVE_FRAME), KEEPALIVE_INTERVAL_MS);

      const onEvent = (event: ReconstructionEvent): void => {
        write(formatSseFrame(event));
      };

      void designWebpage({
        url,
        jobId,
        onEvent,
        signal: abortController.signal,
      })
        .catch((error: unknown) => {
          // The workflow emits `workflow.failed` itself before rejecting; only
          // log so operators can see unexpected failures. Never log request
          // bodies or environment values.
          if (!abortController.signal.aborted) {
            console.error(
              "[api/reconstruct] conversion failed:",
              error instanceof Error ? error.message : String(error),
            );
          }
        })
        .finally(() => {
          request.signal.removeEventListener("abort", onClientAbort);
          finish();
        });
    },
    cancel() {
      closed = true;
      if (keepAlive !== undefined) {
        clearInterval(keepAlive);
        keepAlive = undefined;
      }
      abortController.abort();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
