import assert from "node:assert/strict";
import test from "node:test";

import type { ReconstructionSpec } from "../src/reconstruction/reconstruction-spec";
import { RECONSTRUCTION_SPEC_SCHEMA } from "../src/reconstruction/reconstruction-spec-schema";
import { validateReconstructionSpec } from "../src/reconstruction/validate-reconstruction-spec";

const validSpec: ReconstructionSpec = {
  schemaVersion: "1.0",
  source: { url: "https://example.com", title: "Example" },
  page: {
    route: "/generated/example",
    title: "Example",
    maxWidth: 1200,
    padding: 24,
    gap: 20,
    theme: {
      background: "#ffffff",
      surface: "#f5f5f5",
      ink: "#111111",
      accent: "#ff5c35",
      fontFamily: "Arial, sans-serif",
    },
  },
  nodes: [
    {
      id: "node_root",
      component: "HtmlElement",
      sourceElementIds: ["el_0001"],
      order: 0,
      layout: { display: "flex", flexDirection: "column", gap: 20 },
      props: { tag: "main" },
      evidence: {
        sourceConnectionIds: [],
        confidence: 1,
        rationale: "Preserves the source main landmark.",
      },
    },
    {
      id: "node_title",
      component: "Text3D",
      sourceElementIds: ["el_0002"],
      parentId: "node_root",
      order: 0,
      layout: {},
      props: { text: "Example", fontSize: 48, semanticTag: "h1" },
      evidence: {
        sourceConnectionIds: [],
        confidence: 1,
        rationale: "Matches the source heading.",
      },
    },
    {
      id: "node_image",
      component: "Image3D",
      sourceElementIds: ["el_0003"],
      parentId: "node_root",
      order: 1,
      layout: { widthMode: "full" },
      props: { assetId: "asset_logo", alt: "Example logo", depth: 16 },
      evidence: {
        sourceConnectionIds: [],
        confidence: 0.98,
        rationale: "Uses the locally cached source image.",
      },
    },
    {
      id: "node_action",
      component: "Button3D",
      sourceElementIds: ["el_0004"],
      parentId: "node_root",
      order: 2,
      layout: {},
      props: { label: "Continue", buttonType: "button", tilt: 1 },
      evidence: {
        sourceConnectionIds: ["conn_0001"],
        confidence: 0.95,
        rationale: "Preserves the source call to action.",
      },
    },
  ],
  interactions: [
    {
      id: "interaction_continue",
      sourceNodeId: "node_action",
      sourceConnectionIds: ["conn_0001"],
      event: "click",
      action: "navigate",
      destination: "/next",
      description: "Continue to the next page.",
    },
  ],
  unresolved: [],
  notes: [],
};

const referenceContext = {
  elementIds: ["el_0001", "el_0002", "el_0003", "el_0004"],
  connectionIds: ["conn_0001"],
  assetIds: ["asset_logo"],
  requireElementCoverage: true,
};

test("exports a strict Draft 2020-12 reconstruction schema", () => {
  assert.equal(
    RECONSTRUCTION_SPEC_SCHEMA.$schema,
    "https://json-schema.org/draft/2020-12/schema",
  );
  assert.equal(RECONSTRUCTION_SPEC_SCHEMA.additionalProperties, false);
});

test("accepts an evidence-linked reconstruction using a local image asset", () => {
  const result = validateReconstructionSpec(validSpec, referenceContext);
  assert.equal(result.valid, true);
});

test("rejects invented source and asset references", () => {
  const invalid = structuredClone(validSpec);
  const image = invalid.nodes.find((node) => node.component === "Image3D");
  assert.ok(image && image.component === "Image3D");
  image.props.assetId = "asset_invented";
  image.sourceElementIds = ["el_invented"];

  const result = validateReconstructionSpec(invalid, referenceContext);
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.errors.some((error) => error.includes("unknown asset")));
    assert.ok(result.errors.some((error) => error.includes("unknown source element")));
  }
});

test("rejects unsupported component props", () => {
  const invalid = structuredClone(validSpec) as unknown as Record<string, unknown>;
  const nodes = invalid.nodes as Array<Record<string, unknown>>;
  (nodes[1].props as Record<string, unknown>).unsupported = true;

  const result = validateReconstructionSpec(invalid, referenceContext);
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(
      result.errors.some((error) => error.includes("additional properties")),
    );
  }
});

test("rejects hierarchy cycles", () => {
  const invalid = structuredClone(validSpec);
  invalid.nodes[0].parentId = "node_title";

  const result = validateReconstructionSpec(invalid, referenceContext);
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.errors.some((error) => error.includes("cycle")));
  }
});
