import assert from "node:assert/strict";
import test from "node:test";

import {
  createReconstructionSpec,
  ReconstructionAgentOutputError,
  type ReconstructionAgentClient,
} from "../src/agents/reconstruction-agent";
import type { GrokMessage, GrokTextResponse } from "../src/providers/grok";
import type { ParsedWebpageUi } from "../src/webpage/parse-webpage-ui";

function createParsed(overrides: Partial<ParsedWebpageUi> = {}): ParsedWebpageUi {
  return {
    page: { url: "https://example.com/", title: "Example" },
    elements: [
      {
        id: "el_1",
        kind: "content",
        tag: "h1",
        role: "heading",
        text: "Example",
        selector: "h1",
      },
      {
        id: "el_2",
        kind: "interactive",
        tag: "button",
        role: "button",
        name: "Go",
        selector: "button",
      },
    ],
    connections: [],
    assets: { images: [] },
    scripts: { discovered: 0, analyzed: 0, ignored: 0, failed: 0 },
    stats: {
      sourceElements: 2,
      relevantElements: 2,
      connections: 0,
      imageAssets: 0,
      imageBytes: 0,
      estimatedTokens: 10,
    },
    warnings: [],
    ...overrides,
  };
}

function createValidSpec(parsed: ParsedWebpageUi) {
  return {
    schemaVersion: "1.0",
    source: { url: parsed.page.url, title: parsed.page.title },
    page: {
      route: "/generated/example",
      title: parsed.page.title,
      maxWidth: 1200,
      padding: 24,
      gap: 20,
      theme: {
        background: "#0a0604",
        surface: "#141414",
        ink: "#e8dcc8",
        accent: "#00a8ff",
        fontFamily: "Quantico, sans-serif",
      },
    },
    nodes: [
      {
        id: "node_heading",
        component: "Text3D",
        sourceElementIds: ["el_1"],
        order: 0,
        layout: {},
        props: { text: "Example", fontSize: 40, semanticTag: "h1" },
        evidence: { sourceConnectionIds: [], confidence: 1, rationale: "Heading." },
      },
      {
        id: "node_button",
        component: "Button3D",
        sourceElementIds: ["el_2"],
        order: 1,
        layout: {},
        props: { label: "Go" },
        evidence: { sourceConnectionIds: [], confidence: 1, rationale: "Button." },
      },
    ],
    interactions: [],
    unresolved: [],
    notes: [],
  };
}

function createScriptedClient(
  responses: string[],
  captured: GrokMessage[][] = [],
): ReconstructionAgentClient {
  let index = 0;
  return {
    model: "grok-test",
    async generateText(input): Promise<GrokTextResponse> {
      captured.push(input as GrokMessage[]);
      const text = responses[index];
      index += 1;
      assert.ok(text !== undefined, "unexpected extra model request");
      return { id: `resp_${index}`, model: "grok-test", text };
    },
  };
}

test("accepts a valid first response without a repair round", async () => {
  const parsed = createParsed();
  const captured: GrokMessage[][] = [];
  const repairs: string[][] = [];
  const responses: string[] = [];
  const client = createScriptedClient(
    [JSON.stringify(createValidSpec(parsed))],
    captured,
  );

  const result = await createReconstructionSpec(parsed, client, {
    onRepairAttempt: (errors) => {
      repairs.push(errors);
    },
    onModelResponse: (response) => {
      responses.push(response.id);
    },
  });

  assert.equal(result.spec.nodes.length, 2);
  assert.equal(captured.length, 1);
  assert.deepEqual(repairs, []);
  assert.deepEqual(responses, ["resp_1"]);
  assert.match(captured[0][0].content, /Button3D/);
  assert.match(captured[0][0].content, /Carousel3D/);
  assert.match(captured[0][0].content, /Chrome3D/);
});

test("repairs malformed JSON once and reports the repair hook", async () => {
  const parsed = createParsed();
  const captured: GrokMessage[][] = [];
  const repairs: string[][] = [];
  const responses: string[] = [];
  const client = createScriptedClient(
    ["{not json", JSON.stringify(createValidSpec(parsed))],
    captured,
  );

  const result = await createReconstructionSpec(parsed, client, {
    onRepairAttempt: (errors) => {
      repairs.push(errors);
    },
    onModelResponse: (response) => {
      responses.push(response.id);
    },
  });

  assert.equal(result.response.id, "resp_2");
  assert.deepEqual(repairs, [["malformed JSON"]]);
  assert.deepEqual(responses, ["resp_2"]);
  assert.equal(captured.length, 2);
  assert.deepEqual(
    captured[1].map((message) => message.role),
    ["system", "user", "assistant", "user"],
  );
  assert.equal(captured[1][2].content, "{not json");
  assert.match(captured[1][3].content, /malformed JSON/);
});

test("throws with the repair round's validation errors when both attempts fail", async () => {
  const parsed = createParsed();
  const invalid = createValidSpec(parsed);
  invalid.nodes[1].sourceElementIds = ["el_missing"];
  const client = createScriptedClient([
    JSON.stringify(invalid),
    JSON.stringify(invalid),
  ]);

  await assert.rejects(
    createReconstructionSpec(parsed, client),
    (error: unknown) => {
      assert.ok(error instanceof ReconstructionAgentOutputError);
      assert.ok(error.validationErrors.length > 0);
      assert.ok(
        error.validationErrors.some((message) => message.includes("el_missing")),
      );
      return true;
    },
  );
});

test("caps the number of quoted validation errors in the repair request", async () => {
  const parsed = createParsed();
  const invalid = createValidSpec(parsed);
  // Add far more broken nodes than the repair message will quote.
  for (let index = 0; index < 60; index += 1) {
    invalid.nodes.push({
      id: `node_bad_${index}`,
      component: "Text3D",
      sourceElementIds: [`el_missing_${index}`],
      order: index + 2,
      layout: {},
      props: { text: "x", fontSize: 40, semanticTag: "h2" },
      evidence: { sourceConnectionIds: [], confidence: 1, rationale: "Bad." },
    });
  }
  const captured: GrokMessage[][] = [];
  const repairs: string[][] = [];
  const client = createScriptedClient(
    [JSON.stringify(invalid), JSON.stringify(createValidSpec(parsed))],
    captured,
  );

  await createReconstructionSpec(parsed, client, {
    onRepairAttempt: (errors) => {
      repairs.push(errors);
    },
  });

  assert.equal(repairs.length, 1);
  assert.equal(repairs[0].length, 40);
  const quotedLines = captured[1][3].content
    .split("\n")
    .filter((line) => line.startsWith("- "));
  assert.equal(quotedLines.length, 40);
});

test("forwards the abort signal to the model client", async () => {
  const parsed = createParsed();
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  const client: ReconstructionAgentClient = {
    model: "grok-test",
    async generateText(_input, options) {
      receivedSignal = options?.signal;
      return {
        id: "resp_1",
        model: "grok-test",
        text: JSON.stringify(createValidSpec(parsed)),
      };
    },
  };

  await createReconstructionSpec(parsed, client, { signal: controller.signal });
  assert.equal(receivedSignal, controller.signal);
});

test("truncates long element text when the serialized input is too large", async () => {
  const longText = "x".repeat(5_000);
  const elements = Array.from({ length: 150 }, (_value, index) => ({
    id: `el_${index}`,
    kind: "content" as const,
    tag: "p",
    role: "paragraph",
    name: longText,
    text: longText,
    selector: `p:nth-of-type(${index + 1})`,
  }));
  const parsed = createParsed({ elements });
  const captured: GrokMessage[][] = [];
  const spec = {
    ...createValidSpec(parsed),
    // sourceElementIds is capped at 128 entries per node, so split the coverage.
    nodes: [
      {
        id: "node_list_a",
        component: "HtmlElement",
        sourceElementIds: elements.slice(0, 75).map((element) => element.id),
        order: 0,
        layout: {},
        props: { tag: "div" },
        evidence: { sourceConnectionIds: [], confidence: 1, rationale: "First half." },
      },
      {
        id: "node_list_b",
        component: "HtmlElement",
        sourceElementIds: elements.slice(75).map((element) => element.id),
        order: 1,
        layout: {},
        props: { tag: "div" },
        evidence: { sourceConnectionIds: [], confidence: 1, rationale: "Second half." },
      },
    ],
  };
  const client = createScriptedClient([JSON.stringify(spec)], captured);

  await createReconstructionSpec(parsed, client);

  const userMessage = captured[0][1].content;
  const graph = JSON.parse(userMessage.slice(userMessage.indexOf("{"))) as {
    elements: Array<{ id: string; name: string; text: string }>;
  };
  assert.equal(graph.elements.length, 150);
  assert.equal(graph.elements[0].id, "el_0");
  assert.equal(graph.elements[0].name.length, 200);
  assert.equal(graph.elements[0].text.length, 200);
  assert.ok(userMessage.length < 600_000);
  // The original parsed graph is left untouched.
  assert.equal(parsed.elements[0].text?.length, 5_000);
});
