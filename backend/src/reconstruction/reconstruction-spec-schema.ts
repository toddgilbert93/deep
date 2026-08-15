import { RECONSTRUCTION_COMPONENTS } from "./reconstruction-spec";

const boundedString = { type: "string", minLength: 1, maxLength: 2_000 };
const positiveNumber = { type: "number", minimum: 0, maximum: 4_096 };
const idArray = {
  type: "array",
  items: { type: "string", minLength: 1, maxLength: 200 },
  minItems: 1,
  maxItems: 128,
};

const propSchemas = {
  Button3D: {
    properties: {
      label: boundedString,
      width: positiveNumber,
      height: positiveNumber,
      depth: positiveNumber,
      spin: { type: "number", minimum: -360, maximum: 360 },
      nested: { type: "boolean" },
      tilt: { type: "integer", minimum: 0, maximum: 5 },
      face: boundedString,
      ink: boundedString,
      fontFamily: boundedString,
      disabled: { type: "boolean" },
      buttonType: { enum: ["button", "submit", "reset"] },
    },
    required: ["label"],
  },
  Button3DGroup: { properties: {}, required: [] },
  Card3D: {
    properties: {
      width: positiveNumber,
      height: positiveNumber,
      depth: positiveNumber,
      face: boundedString,
      ink: boundedString,
      fontFamily: boundedString,
    },
    required: [],
  },
  Carousel3D: {
    properties: {
      spin: { type: "number", minimum: -360, maximum: 360 },
      itemCount: { type: "integer", minimum: 3, maximum: 8 },
    },
    required: ["itemCount"],
  },
  Chrome3D: {
    properties: { depth: positiveNumber },
    required: [],
  },
  Icon3D: {
    properties: {
      name: {
        enum: [
          "plus",
          "minus",
          "close",
          "check",
          "chevronLeft",
          "chevronRight",
          "arrowUp",
          "menu",
          "square",
          "play",
          "more",
          "cuboid",
        ],
      },
      size: positiveNumber,
      depth: positiveNumber,
      spin: { type: "number", minimum: -360, maximum: 360 },
      face: boundedString,
    },
    required: ["name"],
  },
  Image3D: {
    properties: {
      assetId: boundedString,
      alt: { type: "string", maxLength: 2_000 },
      width: positiveNumber,
      height: positiveNumber,
      depth: positiveNumber,
    },
    required: ["assetId", "alt"],
  },
  Text3D: {
    properties: {
      text: boundedString,
      fontSize: { type: "number", minimum: 32, maximum: 256 },
      depth: positiveNumber,
      ink: boundedString,
      fontFamily: boundedString,
      semanticTag: { enum: ["h1", "h2", "h3", "h4", "h5", "h6", "span"] },
    },
    required: ["text", "fontSize"],
  },
  TextShadow3D: {
    properties: {
      text: boundedString,
      fontSize: { type: "number", minimum: 16, maximum: 24 },
      depth: positiveNumber,
      ink: boundedString,
      fontFamily: boundedString,
      semanticTag: { enum: ["p", "span", "label", "li"] },
    },
    required: ["text", "fontSize"],
  },
  HtmlElement: {
    properties: {
      tag: {
        enum: [
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
        ],
      },
      text: { type: "string", maxLength: 2_000 },
      href: boundedString,
      action: boundedString,
      method: { enum: ["get", "post", "dialog"] },
      inputType: {
        enum: [
          "text",
          "email",
          "url",
          "password",
          "number",
          "checkbox",
          "radio",
          "submit",
        ],
      },
      name: boundedString,
      placeholder: { type: "string", maxLength: 500 },
      required: { type: "boolean" },
      ariaLabel: boundedString,
    },
    required: ["tag"],
  },
} as const;

const nodeProperties = {
  id: { type: "string", pattern: "^node_[A-Za-z0-9_-]+$", maxLength: 200 },
  sourceElementIds: idArray,
  parentId: { type: "string", pattern: "^node_[A-Za-z0-9_-]+$", maxLength: 200 },
  order: { type: "integer", minimum: 0, maximum: 10_000 },
  layout: { $ref: "#/$defs/layout" },
  evidence: { $ref: "#/$defs/evidence" },
};

const nodeRequired = [
  "id",
  "component",
  "sourceElementIds",
  "order",
  "layout",
  "props",
  "evidence",
];

const nodeVariants = RECONSTRUCTION_COMPONENTS.map((component) => ({
  type: "object",
  additionalProperties: false,
  properties: {
    ...nodeProperties,
    component: { const: component },
    props: {
      type: "object",
      additionalProperties: false,
      properties: propSchemas[component].properties,
      required: propSchemas[component].required,
    },
  },
  required: nodeRequired,
}));

export const RECONSTRUCTION_SPEC_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://deep.local/schemas/reconstruction-spec-1.0.json",
  title: "Deep Reconstruction Specification",
  description:
    "An evidence-linked plan for rebuilding a source webpage with Deep's approved 3DUI components.",
  type: "object",
  additionalProperties: false,
  properties: {
    schemaVersion: { const: "1.0" },
    source: {
      type: "object",
      additionalProperties: false,
      properties: {
        url: { type: "string", minLength: 1, maxLength: 2_000 },
        title: { type: "string", maxLength: 500 },
      },
      required: ["url", "title"],
    },
    page: {
      type: "object",
      additionalProperties: false,
      properties: {
        route: { type: "string", pattern: "^/", maxLength: 300 },
        title: boundedString,
        description: { type: "string", maxLength: 2_000 },
        maxWidth: { type: "number", minimum: 320, maximum: 4_096 },
        padding: { type: "number", minimum: 0, maximum: 256 },
        gap: { type: "number", minimum: 0, maximum: 256 },
        theme: {
          type: "object",
          additionalProperties: false,
          properties: {
            background: boundedString,
            surface: boundedString,
            ink: boundedString,
            accent: boundedString,
            fontFamily: boundedString,
          },
          required: ["background", "surface", "ink", "accent", "fontFamily"],
        },
      },
      required: ["route", "title", "maxWidth", "padding", "gap", "theme"],
    },
    nodes: {
      type: "array",
      items: { oneOf: nodeVariants },
      minItems: 1,
      maxItems: 256,
    },
    interactions: {
      type: "array",
      items: { $ref: "#/$defs/interaction" },
      maxItems: 256,
    },
    unresolved: {
      type: "array",
      items: { $ref: "#/$defs/unresolved" },
      maxItems: 256,
    },
    notes: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 1_000 },
      maxItems: 20,
    },
  },
  required: [
    "schemaVersion",
    "source",
    "page",
    "nodes",
    "interactions",
    "unresolved",
    "notes",
  ],
  $defs: {
    layout: {
      type: "object",
      additionalProperties: false,
      properties: {
        display: { enum: ["block", "flex", "grid", "inline-flex", "none"] },
        position: { enum: ["static", "relative", "absolute", "sticky", "fixed"] },
        widthMode: { enum: ["auto", "full", "fit", "fixed"] },
        width: positiveNumber,
        height: positiveNumber,
        maxWidth: positiveNumber,
        gap: { type: "number", minimum: 0, maximum: 256 },
        padding: { type: "number", minimum: 0, maximum: 256 },
        flexDirection: { enum: ["row", "column"] },
        alignItems: { enum: ["start", "center", "end", "stretch"] },
        justifyContent: {
          enum: ["start", "center", "end", "space-between", "space-around"],
        },
        gridColumns: { type: "integer", minimum: 1, maximum: 12 },
        order: { type: "integer", minimum: 0, maximum: 10_000 },
      },
    },
    evidence: {
      type: "object",
      additionalProperties: false,
      properties: {
        sourceConnectionIds: {
          type: "array",
          items: { type: "string", minLength: 1, maxLength: 200 },
          maxItems: 128,
        },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        rationale: boundedString,
      },
      required: ["sourceConnectionIds", "confidence", "rationale"],
    },
    interaction: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string", pattern: "^interaction_[A-Za-z0-9_-]+$", maxLength: 200 },
        sourceNodeId: { type: "string", pattern: "^node_[A-Za-z0-9_-]+$", maxLength: 200 },
        targetNodeId: { type: "string", pattern: "^node_[A-Za-z0-9_-]+$", maxLength: 200 },
        sourceConnectionIds: idArray,
        event: { enum: ["click", "submit", "input", "change", "focus", "hover"] },
        action: {
          enum: ["navigate", "submit", "toggle", "show", "hide", "select", "request", "carousel"],
        },
        destination: boundedString,
        description: boundedString,
      },
      required: ["id", "sourceNodeId", "sourceConnectionIds", "event", "action", "description"],
    },
    unresolved: {
      type: "object",
      additionalProperties: false,
      properties: {
        sourceElementId: { type: "string", minLength: 1, maxLength: 200 },
        reason: boundedString,
      },
      required: ["sourceElementId", "reason"],
    },
  },
} as const;

export const RECONSTRUCTION_RESPONSE_FORMAT = {
  type: "json_schema",
  name: "reconstruction_spec",
  strict: true,
  schema: RECONSTRUCTION_SPEC_SCHEMA,
} as const;
