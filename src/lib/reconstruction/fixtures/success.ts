/**
 * A realistic successful run for a fake documentation page, "Acme Docs".
 *
 * The run mirrors the backend emitter order (see
 * `backend/src/workflow/reconstruct-webpage.ts`): fetch → parse → cache
 * images → stream source elements → model → validate → stream nodes →
 * completed. The completed event's `result` is a fully valid
 * `ReconstructionSpec` whose nodes equal the streamed node events.
 */
import type {
  ReconstructionEvent,
  ReconstructionNode,
  ReconstructionSpec,
  StreamedSourceElement,
} from "../events";
import { RECONSTRUCTION_HIGHLIGHT_COLOR } from "../events";
import { createFixtureBuilder, itemProgress } from "./build";

export const ACME_SOURCE_URL = "https://docs.acme.example/";
export const ACME_SOURCE_TITLE = "Acme Docs";
export const ACME_HERO_ASSET_ID = "asset_0123456789abcdef01234567";
export const ACME_MODEL = "grok-4-fast-non-reasoning";

export interface AcmeRunOptions {
  /** When false the page has no images: no img element, no Image3D node, images count 0. */
  includeImage?: boolean;
}

interface AcmeScenario {
  elements: StreamedSourceElement[];
  nodes: ReconstructionNode[];
  spec: ReconstructionSpec;
  connectionCount: number;
  imageCount: number;
}

const FONT_FAMILY = "Quantico, sans-serif";

export function buildAcmeScenario(options: AcmeRunOptions = {}): AcmeScenario {
  const includeImage = options.includeImage ?? true;

  const elements: StreamedSourceElement[] = [
    {
      id: "el_0001",
      kind: "structure",
      tag: "header",
      role: "banner",
      name: "Acme Docs",
      selector: "body > header",
    },
    {
      id: "el_0002",
      kind: "interactive",
      tag: "a",
      role: "link",
      name: "Guides",
      selector: "body > header > nav > a:nth-of-type(1)",
      parentId: "el_0001",
    },
    {
      id: "el_0003",
      kind: "interactive",
      tag: "a",
      role: "link",
      name: "API reference",
      selector: "body > header > nav > a:nth-of-type(2)",
      parentId: "el_0001",
    },
    {
      id: "el_0004",
      kind: "content",
      tag: "h1",
      role: "heading",
      text: "Build faster with Acme",
      selector: "main > h1",
    },
    ...(includeImage
      ? [
          {
            id: "el_0005",
            kind: "content",
            tag: "img",
            role: "img",
            name: "Acme dashboard preview",
            selector: "main > img",
            assetId: ACME_HERO_ASSET_ID,
          } satisfies StreamedSourceElement,
        ]
      : []),
    {
      id: "el_0006",
      kind: "interactive",
      tag: "button",
      role: "button",
      name: "Get started",
      selector: "main > button",
    },
  ];

  const nodes: ReconstructionNode[] = [
    {
      id: "node_header",
      component: "HtmlElement",
      sourceElementIds: ["el_0001"],
      order: 0,
      layout: {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        widthMode: "full",
        padding: 16,
        gap: 24,
      },
      props: { tag: "header", ariaLabel: "Acme Docs" },
      evidence: {
        sourceConnectionIds: [],
        confidence: 0.96,
        rationale: "The banner landmark becomes a preserved header element.",
      },
    },
    {
      id: "node_nav",
      component: "HtmlElement",
      sourceElementIds: ["el_0001"],
      parentId: "node_header",
      order: 0,
      layout: { display: "flex", flexDirection: "row", gap: 16, alignItems: "center" },
      props: { tag: "nav", ariaLabel: "Primary" },
      evidence: {
        sourceConnectionIds: [],
        confidence: 0.9,
        rationale: "The header's link cluster is preserved as primary navigation.",
      },
    },
    {
      id: "node_nav_guides",
      component: "HtmlElement",
      sourceElementIds: ["el_0002"],
      parentId: "node_nav",
      order: 0,
      layout: { display: "inline-flex" },
      props: { tag: "a", text: "Guides", href: "/guides" },
      evidence: {
        sourceConnectionIds: ["rel_0001"],
        confidence: 0.94,
        rationale: "Navigation links stay real anchors so keyboard navigation is preserved.",
      },
    },
    {
      id: "node_hero_title",
      component: "Text3D",
      sourceElementIds: ["el_0004"],
      order: 1,
      layout: { display: "block", widthMode: "full", padding: 8 },
      props: {
        text: "Build faster with Acme",
        fontSize: 48,
        depth: 18,
        ink: "#e8dcc8",
        fontFamily: FONT_FAMILY,
        semanticTag: "h1",
      },
      evidence: {
        sourceConnectionIds: [],
        confidence: 0.98,
        rationale: "A 48px page heading maps to extruded Text3D.",
      },
    },
    ...(includeImage
      ? [
          {
            id: "node_hero_image",
            component: "Image3D",
            sourceElementIds: ["el_0005"],
            order: 2,
            layout: { display: "block", widthMode: "fixed", width: 480, height: 300 },
            props: {
              assetId: ACME_HERO_ASSET_ID,
              alt: "Acme dashboard preview",
              width: 480,
              height: 300,
              depth: 12,
            },
            evidence: {
              sourceConnectionIds: [],
              confidence: 0.92,
              rationale: "The hero image is served from the locally cached asset.",
            },
          } satisfies ReconstructionNode,
        ]
      : []),
    {
      id: "node_actions",
      component: "Button3DGroup",
      sourceElementIds: ["el_0006", "el_0003"],
      order: 3,
      layout: { display: "flex", flexDirection: "row", gap: 16, justifyContent: "center" },
      props: {},
      evidence: {
        sourceConnectionIds: ["rel_0002", "rel_0003"],
        confidence: 0.85,
        rationale: "The primary call to action and the API link form one action group.",
      },
    },
    {
      id: "node_cta_primary",
      component: "Button3D",
      sourceElementIds: ["el_0006"],
      parentId: "node_actions",
      order: 0,
      layout: { display: "inline-flex" },
      props: {
        label: "Get started",
        width: 200,
        height: 56,
        face: "#00a8ff",
        ink: "#0a0604",
        fontFamily: FONT_FAMILY,
        buttonType: "button",
      },
      evidence: {
        sourceConnectionIds: ["rel_0003"],
        confidence: 0.97,
        rationale: "The source button becomes the primary Button3D.",
      },
    },
    {
      id: "node_cta_secondary",
      component: "Button3D",
      sourceElementIds: ["el_0003"],
      parentId: "node_actions",
      order: 1,
      layout: { display: "inline-flex" },
      props: {
        label: "API reference",
        width: 200,
        height: 56,
        face: "#0a1218",
        ink: "#e8dcc8",
        fontFamily: FONT_FAMILY,
        buttonType: "button",
      },
      evidence: {
        sourceConnectionIds: ["rel_0002"],
        confidence: 0.72,
        rationale: "The API reference link is promoted to a secondary call to action.",
      },
    },
  ];

  const spec: ReconstructionSpec = {
    schemaVersion: "1.0",
    source: { url: ACME_SOURCE_URL, title: ACME_SOURCE_TITLE },
    page: {
      route: "/",
      title: ACME_SOURCE_TITLE,
      description: "Documentation landing page for Acme.",
      maxWidth: 1080,
      padding: 24,
      gap: 32,
      theme: {
        background: "#0a0604",
        surface: "#0a1218",
        ink: "#e8dcc8",
        accent: "#00a8ff",
        fontFamily: FONT_FAMILY,
      },
    },
    nodes,
    interactions: [
      {
        id: "interaction_nav_guides",
        sourceNodeId: "node_nav_guides",
        sourceConnectionIds: ["rel_0001"],
        event: "click",
        action: "navigate",
        destination: "/guides",
        description: "Navigate to the guides section.",
      },
      {
        id: "interaction_cta_secondary",
        sourceNodeId: "node_cta_secondary",
        sourceConnectionIds: ["rel_0002"],
        event: "click",
        action: "navigate",
        destination: "/api",
        description: "Navigate to the API reference.",
      },
      {
        id: "interaction_cta_primary",
        sourceNodeId: "node_cta_primary",
        sourceConnectionIds: ["rel_0003"],
        event: "click",
        action: "navigate",
        destination: "/guides/getting-started",
        description: "Open the getting-started guide.",
      },
    ],
    unresolved: [],
    notes: [
      "The API reference link appears once in the primary nav and once as a secondary CTA.",
      ...(includeImage ? [] : ["The source page had no images; no Image3D nodes were produced."]),
    ],
  };

  return {
    elements,
    nodes,
    spec,
    connectionCount: 3,
    imageCount: includeImage ? 2 : 0,
  };
}

function describeElement(element: StreamedSourceElement): string {
  const identity = element.name ?? element.text ?? element.role;
  return `Recognized ${element.role} ${JSON.stringify(identity)}.`;
}

function describeNode(node: ReconstructionNode): string {
  switch (node.component) {
    case "HtmlElement":
      return `Preserved <${node.props.tag}> as an accessible HtmlElement.`;
    case "Text3D":
      return `Mapped ${node.props.fontSize}px heading to Text3D.`;
    case "Image3D":
      return `Mapped image to Image3D using local asset ${node.props.assetId}.`;
    case "Button3DGroup":
      return "Grouped sibling actions into Button3DGroup.";
    case "Button3D":
      return `Mapped "${node.props.label}" to Button3D.`;
    default:
      return `Mapped source UI to ${node.component}.`;
  }
}

/** Builds the full event list for the Acme Docs run. */
export function buildSuccessRun(options: AcmeRunOptions = {}): ReconstructionEvent[] {
  const scenario = buildAcmeScenario(options);
  const build = createFixtureBuilder();
  const events: ReconstructionEvent[] = [];

  events.push(
    build.emit("fetching_source", 2, {
      type: "workflow.status",
      status: "started",
      message: "Fetching webpage source.",
    }),
    build.emit("fetching_source", 18, {
      type: "workflow.status",
      status: "completed",
      message: "Webpage source fetched.",
    }),
    build.emit("parsing_dom", 20, {
      type: "workflow.status",
      status: "started",
      message: "Parsing UI elements and interactions.",
    }),
    build.emit("parsing_dom", 35, {
      type: "workflow.status",
      status: "completed",
      message: "UI graph created.",
      counts: { elements: scenario.elements.length, connections: scenario.connectionCount },
    }),
    build.emit("caching_assets", 38, {
      type: "workflow.status",
      status: "started",
      message: "Caching webpage images locally.",
    }),
    build.emit("caching_assets", 50, {
      type: "workflow.status",
      status: "completed",
      message: "Local image assets are ready.",
      counts: { images: scenario.imageCount },
    }),
    build.emit("preparing_agent", 51, {
      type: "workflow.status",
      status: "started",
      message: "Preparing compact source evidence for reconstruction.",
    }),
  );

  scenario.elements.forEach((element, index) => {
    events.push(
      build.emit("preparing_agent", 51 + itemProgress(index, scenario.elements.length, 4), {
        type: "source.element",
        message: "Source UI element prepared.",
        element,
        focus: {
          sourceElementIds: [element.id],
          reconstructionNodeIds: [],
          assetIds: element.assetId ? [element.assetId] : [],
          highlightColor: RECONSTRUCTION_HIGHLIGHT_COLOR,
        },
        annotation: describeElement(element),
      }),
    );
  });

  events.push(
    build.emit("preparing_agent", 56, {
      type: "workflow.status",
      status: "completed",
      message: "Compact graph prepared for reconstruction.",
      counts: {
        elements: scenario.elements.length,
        connections: scenario.connectionCount,
        images: scenario.imageCount,
      },
    }),
    build.emit("reconstructing", 60, {
      type: "workflow.status",
      status: "started",
      message: "Mapping the webpage to approved 3DUI components.",
    }),
    build.emit("reconstructing", 78, {
      type: "workflow.status",
      status: "completed",
      message: "The model returned a structured reconstruction.",
    }),
    build.emit("validating_spec", 80, {
      type: "workflow.status",
      status: "started",
      message: "Validating components, evidence, hierarchy, and assets.",
    }),
    build.emit("validating_spec", 84, {
      type: "workflow.status",
      status: "completed",
      message: "Reconstruction specification validated.",
      counts: { nodes: scenario.nodes.length },
    }),
  );

  scenario.nodes.forEach((node, index) => {
    events.push(
      build.emit("presenting_result", 85 + itemProgress(index, scenario.nodes.length, 13), {
        type: "reconstruction.node",
        message: "Reconstructed UI node ready.",
        node,
        focus: {
          sourceElementIds: node.sourceElementIds,
          reconstructionNodeIds: [node.id],
          assetIds: node.component === "Image3D" ? [node.props.assetId] : [],
          highlightColor: RECONSTRUCTION_HIGHLIGHT_COLOR,
        },
        annotation: describeNode(node),
      }),
    );
  });

  events.push(
    build.emit("completed", 100, {
      type: "workflow.completed",
      status: "completed",
      message: "Webpage reconstruction is ready.",
      model: ACME_MODEL,
      responseId: "resp_fixture_acme_docs",
      usage: { inputTokens: 4210, outputTokens: 1830, totalTokens: 6040 },
      result: scenario.spec,
    }),
  );

  return events;
}

export const SUCCESS_EVENTS: readonly ReconstructionEvent[] = buildSuccessRun();

/** Index of the "reconstructing completed" event — the end of the model stage. */
export const SUCCESS_MODEL_RESPONSE_INDEX = SUCCESS_EVENTS.findIndex(
  (event) =>
    event.type === "workflow.status" &&
    event.stage === "reconstructing" &&
    event.status === "completed",
);
