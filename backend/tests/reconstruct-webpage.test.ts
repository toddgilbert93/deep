import assert from "node:assert/strict";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import type { ReconstructionAgentClient } from "../src/agents/reconstruction-agent";
import { FileImageAssetStore } from "../src/assets/file-image-asset-store";
import {
  GrokConfigurationError,
  type GrokMessage,
  type GrokTextResponse,
} from "../src/providers/grok";
import type { ReconstructionEvent } from "../src/workflow/reconstruction-events";
import {
  ReconstructionAbortedError,
  reconstructWebpage,
} from "../src/workflow/reconstruct-webpage";

const fixtureDirectory = path.join(
  process.cwd(),
  "backend/tests/fixtures/simple-site",
);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("connects collection, parsing, assets, Grok, validation, and UI events", async (t) => {
  const { url, assetStore } = await startFixture(t);
  const events: ReconstructionEvent[] = [];
  const client = createMockReconstructionClient();
  const result = await reconstructWebpage({
    url,
    allowPrivateNetwork: true,
    jobId: "job_test",
    client,
    assetStore,
    onEvent: (event) => {
      events.push(event);
    },
  });

  assert.equal(result.spec.nodes.length, result.parsed.elements.length);
  assert.equal(result.parsed.assets.images.length, 1);
  assert.equal(events[0].type, "workflow.status");
  assert.equal(events.at(-1)?.type, "workflow.completed");
  assert.equal(
    events.filter((event) => event.type === "source.element").length,
    result.parsed.elements.length,
  );
  assert.equal(
    events.filter((event) => event.type === "reconstruction.node").length,
    result.spec.nodes.length,
  );
  assert.deepEqual(
    events.map((event) => event.sequence),
    events.map((_event, index) => index + 1),
  );
  assert.ok(
    events.every(
      (event, index) => index === 0 || event.progress >= events[index - 1].progress,
    ),
  );
  assert.ok(
    events
      .filter((event) => "focus" in event)
      .every((event) => event.focus.highlightColor === "#22c55e"),
  );
  assert.equal(
    events.filter(
      (event) =>
        event.type === "workflow.status" &&
        event.message === "Repairing the reconstruction after validation errors.",
    ).length,
    0,
  );
});

test("classifies a missing model configuration as MODEL_NOT_CONFIGURED", async (t) => {
  const { url, assetStore } = await startFixture(t);
  const events: ReconstructionEvent[] = [];
  const client: ReconstructionAgentClient = {
    model: "grok-test",
    async generateText() {
      throw new GrokConfigurationError(
        "XAI_API_KEY is required before calling Grok.",
      );
    },
  };

  await assert.rejects(
    reconstructWebpage({
      url,
      allowPrivateNetwork: true,
      jobId: "job_not_configured",
      client,
      assetStore,
      onEvent: (event) => {
        events.push(event);
      },
    }),
    GrokConfigurationError,
  );

  const failed = events.at(-1);
  assert.ok(failed && failed.type === "workflow.failed");
  assert.equal(failed.stage, "failed");
  assert.deepEqual(failed.error, {
    code: "MODEL_NOT_CONFIGURED",
    retryable: false,
  });
  assert.equal(failed.message, "The reconstruction model is not configured.");
  assert.equal(
    events.filter((event) => event.type === "workflow.completed").length,
    0,
  );
});

test("repairs an invalid first specification with one follow-up request", async (t) => {
  const { url, assetStore } = await startFixture(t);
  const events: ReconstructionEvent[] = [];
  const requests: GrokMessage[][] = [];
  const client = createMockReconstructionClient({
    onRequest: (input) => {
      requests.push(input);
    },
    // Break the first response: reference a source element that does not exist.
    mutateSpec: (spec, attempt) => {
      if (attempt === 1) {
        spec.nodes[0].sourceElementIds = ["el_missing"];
      }
      return spec;
    },
  });

  const result = await reconstructWebpage({
    url,
    allowPrivateNetwork: true,
    jobId: "job_repair",
    client,
    assetStore,
    onEvent: (event) => {
      events.push(event);
    },
  });

  assert.equal(requests.length, 2);
  assert.equal(result.responseId, "resp_test_2");
  assert.equal(result.spec.nodes.length, result.parsed.elements.length);

  const repairRequest = requests[1];
  assert.deepEqual(
    repairRequest.map((message) => message.role),
    ["system", "user", "assistant", "user"],
  );
  assert.deepEqual(repairRequest[0], requests[0][0]);
  assert.deepEqual(repairRequest[1], requests[0][1]);
  assert.ok(repairRequest[2].content.startsWith("{"));
  assert.match(repairRequest[3].content, /el_missing/);
  assert.match(repairRequest[3].content, /corrected, complete ReconstructionSpec/);

  const repairEvents = events.filter(
    (event) =>
      event.type === "workflow.status" &&
      event.message === "Repairing the reconstruction after validation errors.",
  );
  assert.equal(repairEvents.length, 1);
  const repairEvent = repairEvents[0];
  assert.equal(repairEvent.stage, "reconstructing");
  assert.equal(repairEvent.progress, 70);
  assert.ok(repairEvent.type === "workflow.status" && repairEvent.status === "progress");

  const reconstructingStarted = events.findIndex(
    (event) =>
      event.type === "workflow.status" &&
      event.stage === "reconstructing" &&
      event.status === "started",
  );
  const reconstructingCompleted = events.findIndex(
    (event) =>
      event.type === "workflow.status" &&
      event.stage === "reconstructing" &&
      event.status === "completed",
  );
  const repairIndex = events.indexOf(repairEvent);
  assert.ok(reconstructingStarted >= 0);
  assert.ok(reconstructingCompleted > repairIndex);
  assert.ok(repairIndex > reconstructingStarted);
  assert.equal(
    events.filter(
      (event) =>
        event.type === "workflow.status" &&
        event.stage === "reconstructing" &&
        event.status === "completed",
    ).length,
    1,
  );
  assert.equal(events.at(-1)?.type, "workflow.completed");
  assert.deepEqual(
    events.map((event) => event.sequence),
    events.map((_event, index) => index + 1),
  );
  assert.ok(
    events.every(
      (event, index) => index === 0 || event.progress >= events[index - 1].progress,
    ),
  );
});

test("fails with INVALID_RECONSTRUCTION when the repair round is also invalid", async (t) => {
  const { url, assetStore } = await startFixture(t);
  const events: ReconstructionEvent[] = [];
  let attempts = 0;
  const client = createMockReconstructionClient({
    onRequest: () => {
      attempts += 1;
    },
    mutateSpec: (spec) => {
      spec.nodes[0].sourceElementIds = ["el_missing"];
      return spec;
    },
  });

  await assert.rejects(
    reconstructWebpage({
      url,
      allowPrivateNetwork: true,
      jobId: "job_repair_failed",
      client,
      assetStore,
      onEvent: (event) => {
        events.push(event);
      },
    }),
    (error: unknown) =>
      error instanceof Error &&
      error.name === "ReconstructionAgentOutputError" &&
      "validationErrors" in error &&
      Array.isArray(error.validationErrors) &&
      error.validationErrors.length > 0,
  );

  assert.equal(attempts, 2);
  const failed = events.at(-1);
  assert.ok(failed && failed.type === "workflow.failed");
  assert.deepEqual(failed.error, {
    code: "INVALID_RECONSTRUCTION",
    retryable: true,
  });
});

test("cancels before the first stage when the signal is already aborted", async (t) => {
  const { url, assetStore } = await startFixture(t);
  const events: ReconstructionEvent[] = [];
  let modelCalls = 0;
  const client: ReconstructionAgentClient = {
    model: "grok-test",
    async generateText() {
      modelCalls += 1;
      throw new Error("The model must not be called after cancellation.");
    },
  };
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    reconstructWebpage({
      url,
      allowPrivateNetwork: true,
      jobId: "job_aborted",
      client,
      assetStore,
      signal: controller.signal,
      onEvent: (event) => {
        events.push(event);
      },
    }),
    ReconstructionAbortedError,
  );

  assert.equal(modelCalls, 0);
  assert.equal(events.length, 1);
  const failed = events[0];
  assert.ok(failed.type === "workflow.failed");
  assert.equal(failed.jobId, "job_aborted");
  assert.equal(failed.stage, "failed");
  assert.equal(failed.progress, 0);
  assert.equal(failed.message, "The conversion was cancelled.");
  assert.deepEqual(failed.error, { code: "WORKFLOW_ABORTED", retryable: true });
});

test("forwards the abort signal to the model request and reports cancellation", async (t) => {
  const { url, assetStore } = await startFixture(t);
  const events: ReconstructionEvent[] = [];
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  const client: ReconstructionAgentClient = {
    model: "grok-test",
    async generateText(_input, options) {
      receivedSignal = options?.signal;
      controller.abort();
      throw new DOMException("The operation was aborted.", "AbortError");
    },
  };

  await assert.rejects(
    reconstructWebpage({
      url,
      allowPrivateNetwork: true,
      jobId: "job_aborted_mid_model",
      client,
      assetStore,
      signal: controller.signal,
      onEvent: (event) => {
        events.push(event);
      },
    }),
    ReconstructionAbortedError,
  );

  assert.equal(receivedSignal, controller.signal);
  const failed = events.at(-1);
  assert.ok(failed && failed.type === "workflow.failed");
  assert.deepEqual(failed.error, { code: "WORKFLOW_ABORTED", retryable: true });
});

async function startFixture(
  t: TestContext,
): Promise<{ url: string; assetStore: FileImageAssetStore }> {
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "deep-reconstruction-workflow-"),
  );
  const indexHtml = await readFile(
    path.join(fixtureDirectory, "index.html"),
    "utf8",
  );
  const appJavaScript = await readFile(
    path.join(fixtureDirectory, "app.js"),
    "utf8",
  );
  const server: Server = createServer((request, response) => {
    if (request.url === "/app.js") {
      response.writeHead(200, { "Content-Type": "application/javascript" });
      response.end(appJavaScript);
      return;
    }
    if (request.url === "/product.png") {
      response.writeHead(200, { "Content-Type": "image/png" });
      response.end(png);
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(indexHtml);
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    assetStore: new FileImageAssetStore({
      storageDirectory: path.join(temporaryDirectory, "storage"),
      cacheDirectory: path.join(temporaryDirectory, "cache"),
    }),
  };
}

interface MockClientOptions {
  onRequest?: (input: GrokMessage[]) => void;
  /** Adjust the generated spec for a given 1-based attempt before it is returned. */
  mutateSpec?: (spec: MockSpec, attempt: number) => MockSpec;
}

interface MockSpec {
  schemaVersion: string;
  source: { url: string; title: string };
  page: Record<string, unknown>;
  nodes: Array<ReturnType<typeof createNode>>;
  interactions: unknown[];
  unresolved: unknown[];
  notes: string[];
}

function createMockReconstructionClient(
  options: MockClientOptions = {},
): ReconstructionAgentClient {
  let attempt = 0;
  return {
    model: "grok-test",
    async generateText(input, requestOptions): Promise<GrokTextResponse> {
      attempt += 1;
      assert.equal(requestOptions?.responseFormat?.name, "reconstruction_spec");
      assert.ok(Array.isArray(input));
      const messages = input as GrokMessage[];
      options.onRequest?.(messages);
      const userMessage = messages.find((message) => message.role === "user");
      assert.ok(userMessage);
      const graph = JSON.parse(
        userMessage.content.slice(userMessage.content.indexOf("{")),
      ) as ParsedAgentInput;
      const nodes = graph.elements.map((element, index) =>
        createNode(element, index),
      );
      let spec: MockSpec = {
        schemaVersion: "1.0",
        source: { url: graph.page.url, title: graph.page.title },
        page: {
          route: "/generated/local-fixture",
          title: graph.page.title || "Generated page",
          maxWidth: 1200,
          padding: 24,
          gap: 20,
          theme: {
            background: "#ffffff",
            surface: "#f5f5f5",
            ink: "#111111",
            accent: "#22c55e",
            fontFamily: "Arial, sans-serif",
          },
        },
        nodes,
        interactions: [],
        unresolved: [],
        notes: [],
      };
      spec = options.mutateSpec?.(spec, attempt) ?? spec;
      return {
        id: `resp_test_${attempt}`,
        model: "grok-test",
        text: JSON.stringify(spec),
        usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
      };
    },
  };
}

interface ParsedAgentInput {
  page: { url: string; title: string };
  elements: Array<{
    id: string;
    tag: string;
    role: string;
    name?: string;
    text?: string;
    assetId?: string;
  }>;
}

function createNode(element: ParsedAgentInput["elements"][number], order: number) {
  const common = {
    id: `node_${element.id}`,
    sourceElementIds: [element.id],
    order,
    layout: {},
    evidence: {
      sourceConnectionIds: [],
      confidence: 1,
      rationale: `Maps ${element.id}.`,
    },
  };
  if (element.tag === "img" && element.assetId) {
    return {
      ...common,
      component: "Image3D",
      props: {
        assetId: element.assetId,
        alt: element.name ?? "Source image",
      },
    };
  }
  if (element.tag === "button") {
    return {
      ...common,
      component: "Button3D",
      props: { label: element.name ?? element.text ?? "Button" },
    };
  }
  if (/^h[1-6]$/.test(element.tag)) {
    return {
      ...common,
      component: "Text3D",
      props: {
        text: element.name ?? element.text ?? "Heading",
        fontSize: 40,
        semanticTag: element.tag,
      },
    };
  }
  return {
    ...common,
    component: "HtmlElement",
    props: {
      tag: toAllowedHtmlTag(element.tag),
      ...(element.text ? { text: element.text } : {}),
    },
  };
}

function toAllowedHtmlTag(tag: string): string {
  const allowed = new Set([
    "div",
    "main",
    "section",
    "nav",
    "header",
    "footer",
    "form",
    "label",
    "input",
    "textarea",
    "select",
    "option",
    "a",
    "p",
    "ul",
    "ol",
    "li",
    "span",
  ]);
  return allowed.has(tag) ? tag : "div";
}
