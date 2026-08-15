import assert from "node:assert/strict";
import test from "node:test";

import {
  createReconstructionSpec,
  ReconstructionAgentOutputError,
  type ReconstructionAgentClient,
} from "../src/agents/reconstruction-agent";
import type { ParsedWebpageUi } from "../src/webpage/parse-webpage-ui";

const parsed: ParsedWebpageUi = {
  page: { url: "https://example.com", title: "Logo page" },
  elements: [
    {
      id: "el_heading",
      kind: "structure",
      tag: "h1",
      role: "heading",
      selector: "h1",
    },
    {
      id: "el_logo",
      kind: "content",
      tag: "img",
      role: "img",
      name: "Logo",
      selector: "h1 > img",
      parentId: "el_heading",
      assetId: "asset_logo",
    },
  ],
  connections: [],
  assets: {
    images: [
      {
        id: "asset_logo",
        sha256: "abc123",
        mimeType: "image/png",
        bytes: 10,
        storageKey: "images/logo.png",
        metadataKey: "metadata/logo.json",
        sources: [
          {
            url: "https://example.com/logo.png",
            finalUrl: "https://example.com/logo.png",
            cacheHit: false,
          },
        ],
      },
    ],
  },
  scripts: { discovered: 0, analyzed: 0, ignored: 0, failed: 0 },
  stats: {
    sourceElements: 2,
    relevantElements: 2,
    connections: 0,
    imageAssets: 1,
    imageBytes: 10,
    estimatedTokens: 100,
  },
  warnings: [],
};

test("accounts for an omitted structural wrapper represented by a mapped child", async () => {
  const result = await createReconstructionSpec(
    parsed,
    createClient(createSpec([createImageNode()])),
  );

  assert.deepEqual(result.spec.unresolved, [
    {
      sourceElementId: "el_heading",
      reason:
        "Structural wrapper is represented by mapped descendant elements.",
    },
  ]);
});

test("still rejects omitted standalone content", async () => {
  await assert.rejects(
    createReconstructionSpec(
      parsed,
      createClient(createSpec([createHeadingNode()])),
    ),
    (error: unknown) => {
      assert.ok(error instanceof ReconstructionAgentOutputError);
      assert.ok(
        error.validationErrors.some((message) =>
          message.includes("el_logo is neither reconstructed nor unresolved"),
        ),
      );
      return true;
    },
  );
});

function createClient(spec: unknown): ReconstructionAgentClient {
  return {
    model: "grok-test",
    async generateText() {
      return {
        id: "resp_test",
        model: "grok-test",
        text: JSON.stringify(spec),
      };
    },
  };
}

function createSpec(nodes: unknown[]) {
  return {
    schemaVersion: "1.0",
    source: { url: parsed.page.url, title: parsed.page.title },
    page: {
      route: "/generated/logo",
      title: "Logo page",
      maxWidth: 1200,
      padding: 24,
      gap: 20,
      theme: {
        background: "#ffffff",
        surface: "#eeeeee",
        ink: "#111111",
        accent: "#22c55e",
        fontFamily: "sans-serif",
      },
    },
    nodes,
    interactions: [],
    unresolved: [],
    notes: [],
  };
}

function createImageNode() {
  return {
    id: "node_logo",
    component: "Image3D",
    sourceElementIds: ["el_logo"],
    order: 0,
    layout: {},
    props: { assetId: "asset_logo", alt: "Logo" },
    evidence: {
      sourceConnectionIds: [],
      confidence: 1,
      rationale: "Maps the source logo.",
    },
  };
}

function createHeadingNode() {
  return {
    id: "node_heading",
    component: "HtmlElement",
    sourceElementIds: ["el_heading"],
    order: 0,
    layout: {},
    props: { tag: "div" },
    evidence: {
      sourceConnectionIds: [],
      confidence: 1,
      rationale: "Maps the heading wrapper.",
    },
  };
}
