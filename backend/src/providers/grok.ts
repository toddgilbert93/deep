const DEFAULT_BASE_URL = "https://api.x.ai/v1";

export const DEFAULT_GROK_MODEL = "grok-4.6";

type FetchImplementation = typeof fetch;

export type GrokRole = "system" | "user" | "assistant";

export interface GrokMessage {
  role: GrokRole;
  content: string;
}

export interface GrokUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costInUsdTicks?: number;
}

export interface GrokTextResponse {
  id: string;
  model: string;
  text: string;
  usage?: GrokUsage;
}

export interface GrokJsonSchemaFormat {
  type: "json_schema";
  name: string;
  schema: object;
  strict?: boolean;
}

export interface GrokGenerateOptions {
  responseFormat?: GrokJsonSchemaFormat;
  /**
   * Optional caller-owned abort signal (for example a disconnected HTTP
   * client). It is combined with the client's request timeout so either one
   * cancels the in-flight, billable request.
   */
  signal?: AbortSignal;
}

export interface GrokStreamOptions extends GrokGenerateOptions {
  /** Receives each text delta as it arrives. */
  onDelta?: (delta: string) => void | Promise<void>;
  /** Fires once, when the first text delta arrives. */
  onFirstDelta?: () => void | Promise<void>;
  /** Receives reasoning-summary deltas when the model emits them. */
  onReasoning?: (delta: string) => void | Promise<void>;
  /** Overrides the client timeout for a long generation. */
  timeoutMs?: number;
  /**
   * Reasoning budget. On grok-4.6 the default spends a long time thinking
   * before the first token (176s on a real design brief); "low" cuts that to a
   * few seconds with no loss of design quality for this task.
   */
  reasoningEffort?: "low" | "high";
}

export interface GrokModel {
  id: string;
  aliases: string[];
}

export interface GrokClientOptions {
  apiKey?: string;
  model?: string;
  /** Defaults to `XAI_REASONING_EFFORT`, then "low". */
  reasoningEffort?: "low" | "high";
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: FetchImplementation;
}

interface XaiErrorBody {
  error?: unknown;
  code?: unknown;
  detail?: unknown;
  message?: unknown;
}

interface XaiResponseBody extends XaiErrorBody {
  id?: unknown;
  model?: unknown;
  output_text?: unknown;
  output?: unknown;
  usage?: unknown;
}

interface XaiModelsBody extends XaiErrorBody {
  data?: unknown;
}

export class GrokConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrokConfigurationError";
  }
}

export class GrokApiError extends Error {
  readonly status: number;
  readonly requestId?: string;

  constructor(status: number, message: string, requestId?: string) {
    const requestSuffix = requestId ? ` [request ${requestId}]` : "";
    super(`xAI API request failed (${status}): ${message}${requestSuffix}`);
    this.name = "GrokApiError";
    this.status = status;
    this.requestId = requestId;
  }
}

export class GrokClient {
  readonly model: string;

  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly reasoningEffort?: "low" | "high";
  private readonly fetchImpl: FetchImplementation;

  constructor(options: GrokClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.XAI_API_KEY;
    this.model =
      (options.model ?? process.env.XAI_MODEL?.trim()) || DEFAULT_GROK_MODEL;
    this.baseUrl = (
      options.baseUrl ??
      process.env.XAI_BASE_URL?.trim() ??
      DEFAULT_BASE_URL
    ).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 360_000;
    this.reasoningEffort =
      options.reasoningEffort ??
      (process.env.XAI_REASONING_EFFORT?.trim() as "low" | "high" | undefined) ??
      "low";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generateText(
    input: string | GrokMessage[],
    options: GrokGenerateOptions = {},
  ): Promise<GrokTextResponse> {
    const apiKey = this.requireApiKey();

    if (typeof input === "string" ? !input.trim() : input.length === 0) {
      throw new GrokConfigurationError("Grok input must not be empty.");
    }

    const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        input,
        ...(options.responseFormat
          ? { text: { format: options.responseFormat } }
          : {}),
      }),
      signal: combineAbortSignals(
        AbortSignal.timeout(this.timeoutMs),
        options.signal,
      ),
    });

    const body = await parseResponseBody<XaiResponseBody>(response);

    if (!response.ok) {
      throw createApiError(response, body);
    }

    const id = getRequiredString(body.id, "response id");
    const model = getRequiredString(body.model, "model");
    const text = extractOutputText(body);

    return {
      id,
      model,
      text,
      usage: parseUsage(body.usage),
    };
  }

  /**
   * Streams a text generation over the Responses API SSE transport, invoking
   * `onDelta` as tokens arrive and resolving with the assembled response.
   *
   * Streaming is what keeps a long design generation feeling live: the caller
   * can forward deltas to the browser instead of blocking on one slow request,
   * and a stalled connection surfaces as a missing delta rather than a
   * multi-minute hang.
   */
  async streamText(
    input: string | GrokMessage[],
    options: GrokStreamOptions = {},
  ): Promise<GrokTextResponse> {
    const apiKey = this.requireApiKey();

    if (typeof input === "string" ? !input.trim() : input.length === 0) {
      throw new GrokConfigurationError("Grok input must not be empty.");
    }

    const effort = options.reasoningEffort ?? this.reasoningEffort;
    const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: this.model,
        input,
        stream: true,
        ...(effort ? { reasoning: { effort } } : {}),
        ...(options.responseFormat
          ? { text: { format: options.responseFormat } }
          : {}),
      }),
      signal: combineAbortSignals(
        AbortSignal.timeout(options.timeoutMs ?? this.timeoutMs),
        options.signal,
      ),
    });

    if (!response.ok) {
      const body = await parseResponseBody<XaiErrorBody>(response).catch(
        () => ({}) as XaiErrorBody,
      );
      throw createApiError(response, body);
    }
    if (!response.body) {
      throw new GrokApiError(502, "The streaming response has no body.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let sawFirstDelta = false;
    let id: string | undefined;
    let model: string | undefined;
    let usage: GrokUsage | undefined;

    const handleEvent = async (event: Record<string, unknown>): Promise<void> => {
      const type = typeof event.type === "string" ? event.type : "";
      const nested = isRecord(event.response) ? event.response : undefined;
      if (nested) {
        if (typeof nested.id === "string") id = nested.id;
        if (typeof nested.model === "string") model = nested.model;
        const nestedUsage = parseUsage(nested.usage);
        if (nestedUsage) usage = nestedUsage;
      }

      if (type === "response.output_text.delta" && typeof event.delta === "string") {
        if (!sawFirstDelta) {
          sawFirstDelta = true;
          await options.onFirstDelta?.();
        }
        text += event.delta;
        await options.onDelta?.(event.delta);
        return;
      }
      if (
        type === "response.reasoning_summary_text.delta" &&
        typeof event.delta === "string"
      ) {
        await options.onReasoning?.(event.delta);
        return;
      }
      if (type === "response.output_text.done" && typeof event.text === "string") {
        // Prefer the authoritative final text when the API supplies it.
        if (event.text.length >= text.length) text = event.text;
        return;
      }
      if (type === "error" || type === "response.failed") {
        const message = isRecord(event.error)
          ? (firstNonEmptyString(event.error.message, event.error.code) ??
            "The streaming request failed.")
          : "The streaming request failed.";
        throw new GrokApiError(502, message);
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline !== -1) {
          const line = buffer.slice(0, newline).replace(/\r$/, "").trim();
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }
          if (isRecord(parsed)) await handleEvent(parsed);
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }

    if (!text.trim()) {
      throw new GrokApiError(502, "The streaming response produced no text.");
    }

    return {
      id: id ?? "stream",
      model: model ?? this.model,
      text,
      usage,
    };
  }

  async listModels(): Promise<GrokModel[]> {
    const apiKey = this.requireApiKey();
    const response = await this.fetchImpl(`${this.baseUrl}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const body = await parseResponseBody<XaiModelsBody>(response);

    if (!response.ok) {
      throw createApiError(response, body);
    }

    if (!Array.isArray(body.data)) {
      throw new GrokApiError(502, "The models response contains no model list.");
    }

    return body.data.flatMap((value): GrokModel[] => {
      if (!isRecord(value) || typeof value.id !== "string") {
        return [];
      }

      return [
        {
          id: value.id,
          aliases: Array.isArray(value.aliases)
            ? value.aliases.filter(
                (alias): alias is string => typeof alias === "string",
              )
            : [],
        },
      ];
    });
  }

  private requireApiKey(): string {
    if (!this.apiKey?.trim()) {
      throw new GrokConfigurationError(
        "XAI_API_KEY is required before calling Grok.",
      );
    }

    return this.apiKey;
  }
}

function combineAbortSignals(
  timeoutSignal: AbortSignal,
  callerSignal?: AbortSignal,
): AbortSignal {
  if (!callerSignal) {
    return timeoutSignal;
  }
  // Node >= 20 provides AbortSignal.any; whichever signal aborts first wins.
  return AbortSignal.any([timeoutSignal, callerSignal]);
}

async function parseResponseBody<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new GrokApiError(response.status, "The API returned invalid JSON.");
  }
}

function createApiError(response: Response, body: XaiErrorBody): GrokApiError {
  const requestId =
    response.headers.get("x-request-id") ??
    response.headers.get("request-id") ??
    undefined;
  return new GrokApiError(
    response.status,
    getApiErrorMessage(body),
    requestId,
  );
}

function getApiErrorMessage(body: XaiErrorBody): string {
  if (typeof body.error === "string" && body.error.length > 0) {
    return body.error;
  }

  if (isRecord(body.error)) {
    const nestedMessage = firstNonEmptyString(
      body.error.message,
      body.error.detail,
      body.error.code,
    );

    if (nestedMessage) {
      return nestedMessage;
    }
  }

  const topLevelMessage = firstNonEmptyString(
    body.message,
    body.detail,
    body.code,
  );

  if (topLevelMessage) {
    return topLevelMessage;
  }

  return "Unknown API error";
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  return values.find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

function getRequiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new GrokApiError(502, `The API response is missing its ${label}.`);
  }

  return value;
}

function extractOutputText(body: XaiResponseBody): string {
  if (typeof body.output_text === "string" && body.output_text.length > 0) {
    return body.output_text;
  }

  if (Array.isArray(body.output)) {
    const text = body.output
      .flatMap((item) => (isRecord(item) && Array.isArray(item.content) ? item.content : []))
      .filter(isRecord)
      .filter((part) => part.type === "output_text" && typeof part.text === "string")
      .map((part) => part.text as string)
      .join("");

    if (text.length > 0) {
      return text;
    }
  }

  throw new GrokApiError(502, "The API response contains no output text.");
}

function parseUsage(value: unknown): GrokUsage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    inputTokens: getOptionalNumber(value.input_tokens),
    outputTokens: getOptionalNumber(value.output_tokens),
    totalTokens: getOptionalNumber(value.total_tokens),
    costInUsdTicks: getOptionalNumber(value.cost_in_usd_ticks),
  };
}

function getOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
