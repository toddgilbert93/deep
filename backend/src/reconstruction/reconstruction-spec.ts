export const RECONSTRUCTION_SCHEMA_VERSION = "1.0" as const;

export const RECONSTRUCTION_COMPONENTS = [
  "Button3D",
  "Button3DGroup",
  "Card3D",
  "Carousel3D",
  "Chrome3D",
  "Icon3D",
  "Image3D",
  "Text3D",
  "TextShadow3D",
  "HtmlElement",
] as const;

export type ReconstructionComponent =
  (typeof RECONSTRUCTION_COMPONENTS)[number];

export interface ReconstructionLayout {
  display?: "block" | "flex" | "grid" | "inline-flex" | "none";
  position?: "static" | "relative" | "absolute" | "sticky" | "fixed";
  widthMode?: "auto" | "full" | "fit" | "fixed";
  width?: number;
  height?: number;
  maxWidth?: number;
  gap?: number;
  padding?: number;
  flexDirection?: "row" | "column";
  alignItems?: "start" | "center" | "end" | "stretch";
  justifyContent?:
    | "start"
    | "center"
    | "end"
    | "space-between"
    | "space-around";
  gridColumns?: number;
  order?: number;
}

export interface ReconstructionEvidence {
  sourceConnectionIds: string[];
  confidence: number;
  rationale: string;
}

interface BaseNode<TComponent extends ReconstructionComponent, TProps> {
  id: string;
  component: TComponent;
  sourceElementIds: string[];
  parentId?: string;
  order: number;
  layout: ReconstructionLayout;
  props: TProps;
  evidence: ReconstructionEvidence;
}

export type Button3DNode = BaseNode<
  "Button3D",
  {
    label: string;
    width?: number;
    height?: number;
    depth?: number;
    spin?: number;
    nested?: boolean;
    tilt?: 0 | 1 | 2 | 3 | 4 | 5;
    face?: string;
    ink?: string;
    fontFamily?: string;
    disabled?: boolean;
    buttonType?: "button" | "submit" | "reset";
  }
>;

export type Button3DGroupNode = BaseNode<"Button3DGroup", Record<string, never>>;

export type Card3DNode = BaseNode<
  "Card3D",
  {
    width?: number;
    height?: number;
    depth?: number;
    face?: string;
    ink?: string;
    fontFamily?: string;
  }
>;

export type Carousel3DNode = BaseNode<
  "Carousel3D",
  { spin?: number; itemCount: number }
>;

export type Chrome3DNode = BaseNode<"Chrome3D", { depth?: number }>;

export type Icon3DNode = BaseNode<
  "Icon3D",
  {
    name:
      | "plus"
      | "minus"
      | "close"
      | "check"
      | "chevronLeft"
      | "chevronRight"
      | "arrowUp"
      | "menu"
      | "square"
      | "play"
      | "more"
      | "cuboid";
    size?: number;
    depth?: number;
    spin?: number;
    face?: string;
  }
>;

export type Image3DNode = BaseNode<
  "Image3D",
  {
    assetId: string;
    alt: string;
    width?: number;
    height?: number;
    depth?: number;
  }
>;

export type Text3DNode = BaseNode<
  "Text3D",
  {
    text: string;
    fontSize: number;
    depth?: number;
    ink?: string;
    fontFamily?: string;
    semanticTag?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "span";
  }
>;

export type TextShadow3DNode = BaseNode<
  "TextShadow3D",
  {
    text: string;
    fontSize: number;
    depth?: number;
    ink?: string;
    fontFamily?: string;
    semanticTag?: "p" | "span" | "label" | "li";
  }
>;

export type HtmlElementNode = BaseNode<
  "HtmlElement",
  {
    tag:
      | "div"
      | "main"
      | "section"
      | "nav"
      | "header"
      | "footer"
      | "form"
      | "label"
      | "input"
      | "textarea"
      | "select"
      | "option"
      | "a"
      | "p"
      | "ul"
      | "ol"
      | "li"
      | "span";
    text?: string;
    href?: string;
    action?: string;
    method?: "get" | "post" | "dialog";
    inputType?:
      | "text"
      | "email"
      | "url"
      | "password"
      | "number"
      | "checkbox"
      | "radio"
      | "submit";
    name?: string;
    placeholder?: string;
    required?: boolean;
    ariaLabel?: string;
  }
>;

export type ReconstructionNode =
  | Button3DNode
  | Button3DGroupNode
  | Card3DNode
  | Carousel3DNode
  | Chrome3DNode
  | Icon3DNode
  | Image3DNode
  | Text3DNode
  | TextShadow3DNode
  | HtmlElementNode;

export interface ReconstructionInteraction {
  id: string;
  sourceNodeId: string;
  targetNodeId?: string;
  sourceConnectionIds: string[];
  event: "click" | "submit" | "input" | "change" | "focus" | "hover";
  action:
    | "navigate"
    | "submit"
    | "toggle"
    | "show"
    | "hide"
    | "select"
    | "request"
    | "carousel";
  destination?: string;
  description: string;
}

export interface ReconstructionSpec {
  schemaVersion: typeof RECONSTRUCTION_SCHEMA_VERSION;
  source: { url: string; title: string };
  page: {
    route: string;
    title: string;
    description?: string;
    maxWidth: number;
    padding: number;
    gap: number;
    theme: {
      background: string;
      surface: string;
      ink: string;
      accent: string;
      fontFamily: string;
    };
  };
  nodes: ReconstructionNode[];
  interactions: ReconstructionInteraction[];
  unresolved: Array<{ sourceElementId: string; reason: string }>;
  notes: string[];
}

export interface ReconstructionReferenceContext {
  elementIds: ReadonlySet<string> | readonly string[];
  connectionIds: ReadonlySet<string> | readonly string[];
  assetIds: ReadonlySet<string> | readonly string[];
  requireElementCoverage?: boolean;
}

export type ReconstructionValidationResult =
  | { valid: true; value: ReconstructionSpec }
  | { valid: false; errors: string[] };
