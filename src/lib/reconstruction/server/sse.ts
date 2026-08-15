/**
 * Server-side helpers for the `/api/reconstruct` Server-Sent Events transport.
 *
 * Pure functions only: no Next.js or Node-only imports so the frame format and
 * request validation can be unit-tested and stay in lock-step with the client
 * parser in `../event-source.ts` and the contract in `openapi.yaml`.
 */
import type { ReconstructionEvent } from "../events";

/** SSE comment line sent periodically so proxies and clients keep the stream open. */
export const SSE_KEEPALIVE_FRAME = ": ping\n\n";

/** Client-chosen job identifiers must match the OpenAPI `ReconstructRequest.jobId` pattern. */
export const JOB_ID_PATTERN = /^job_[A-Za-z0-9-]{8,64}$/;

/**
 * Formats one event as an SSE frame:
 * `id: <sequence>\nevent: <type>\ndata: <JSON>\n\n`.
 *
 * `JSON.stringify` never emits raw newlines, but the payload is still split
 * defensively so a multi-line body can never break the frame boundary.
 */
export function formatSseFrame(event: ReconstructionEvent): string {
  const json = JSON.stringify(event);
  const dataLines = json
    .split(/\r\n|\r|\n/)
    .map((line) => `data: ${line}`)
    .join("\n");
  return `id: ${event.sequence}\nevent: ${event.type}\n${dataLines}\n\n`;
}

export type ReconstructRequestValidation =
  | { ok: true; url: string; jobId?: string }
  | { ok: false; code: "INVALID_REQUEST"; message: string };

/**
 * Validates a parsed `POST /api/reconstruct` body. Accepts an object with an
 * absolute http(s) `url` (no embedded credentials) and an optional `jobId`
 * matching `JOB_ID_PATTERN`. Returns the normalized URL on success.
 */
export function validateReconstructRequest(body: unknown): ReconstructRequestValidation {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return invalid("The request body must be a JSON object with a \"url\" property.");
  }

  const record = body as Record<string, unknown>;
  const rawUrl = record.url;
  if (typeof rawUrl !== "string" || rawUrl.trim().length === 0) {
    return invalid("The \"url\" property is required and must be a non-empty string.");
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return invalid("The \"url\" property must be an absolute URL such as https://example.com/.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return invalid("The \"url\" property must use the http or https scheme.");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return invalid("The \"url\" property must not contain embedded credentials.");
  }
  if (parsed.hostname.length === 0) {
    return invalid("The \"url\" property must include a hostname.");
  }

  const rawJobId = record.jobId;
  if (rawJobId !== undefined) {
    if (typeof rawJobId !== "string" || !JOB_ID_PATTERN.test(rawJobId)) {
      return invalid(
        "The optional \"jobId\" property must match job_ followed by 8 to 64 letters, digits, or hyphens.",
      );
    }
  }

  return rawJobId === undefined
    ? { ok: true, url: parsed.href }
    : { ok: true, url: parsed.href, jobId: rawJobId };
}

function invalid(message: string): ReconstructRequestValidation {
  return { ok: false, code: "INVALID_REQUEST", message };
}
