import type {
  GrokClient,
  GrokMessage,
  GrokTextResponse,
} from "../providers/grok";
import type { ReconstructionSpec } from "../reconstruction/reconstruction-spec";
import { RECONSTRUCTION_RESPONSE_FORMAT } from "../reconstruction/reconstruction-spec-schema";
import { validateReconstructionSpec } from "../reconstruction/validate-reconstruction-spec";
import type { ParsedWebpageUi, UiElement } from "../webpage/parse-webpage-ui";

export interface ReconstructionAgentClient {
  readonly model: string;
  generateText(
    input: string | GrokMessage[],
    options: Parameters<GrokClient["generateText"]>[1],
  ): Promise<GrokTextResponse>;
}

export interface ReconstructionAgentResult {
  spec: ReconstructionSpec;
  response: GrokTextResponse;
}

export interface ReconstructionAgentHooks {
  /**
   * Called exactly once per agent run with the model response that is
   * accepted, or with the repair response when the first attempt was rejected.
   * A rejected first response is not reported here; `onRepairAttempt` is.
   */
  onModelResponse?: (response: GrokTextResponse) => void | Promise<void>;
  /**
   * Called once, before the single repair request, when the first model
   * response is malformed JSON or fails `validateReconstructionSpec`.
   */
  onRepairAttempt?: (errors: string[]) => void | Promise<void>;
  /**
   * Forwarded to every model request so a cancelled conversion stops the
   * billable call as early as possible.
   */
  signal?: AbortSignal;
}

export class ReconstructionAgentOutputError extends Error {
  readonly validationErrors: string[];

  constructor(message: string, validationErrors: string[] = []) {
    super(message);
    this.name = "ReconstructionAgentOutputError";
    this.validationErrors = validationErrors;
  }
}

/** Upper bound for the serialized model input before text fields are trimmed. */
const MAX_INPUT_CHARACTERS = 600_000;
/** Length that `name` and `text` strings are trimmed to when the input is too large. */
const TRUNCATED_TEXT_LENGTH = 200;
/** Maximum number of validation errors quoted back to the model in the repair round. */
const MAX_REPAIR_ERRORS = 40;
const MALFORMED_JSON_ERROR = "malformed JSON";

const SYSTEM_PROMPT = `You are Deep's webpage reconstruction planner.

Create an evidence-linked plan for rebuilding the supplied webpage as a similar 3D webpage. Return only the requested ReconstructionSpec JSON. The JSON Schema is authoritative for every field, component name, prop, and limit.

Rules:
- Use only the component names and props allowed by the supplied JSON Schema. Do not invent props.
- Preserve the source page's title, visible text, reading order, hierarchy, navigation, forms, accessibility semantics, interactions, and locally cached images.
- Build a shallow hierarchy: HtmlElement containers (header, nav, main, section, footer) with 3DUI leaves inside them. Root nodes have no parentId; siblings are ordered by "order".
- Assign every source element to exactly one node's sourceElementIds where possible. Every source element must appear in at least one node's sourceElementIds or in unresolved with a concrete reason.
- Every claimed source element, connection, and asset ID must exist in the input.
- Use Image3D only with an assetId present in the input graph.
- Prefer the approved 3DUI components. Use HtmlElement only for semantic containers, forms and form fields, links, lists, and other behavior the 3DUI library does not provide.
- Do not generate React, CSS, HTML source code, markdown, analysis, or model reasoning.

Component routing:
- Buttons and grouped actions -> Button3D, or Button3DGroup containing Button3D children.
- Cards and bounded content groups -> Card3D.
- Images with an assetId -> Image3D.
- Large headings (32px and above) -> Text3D with fontSize >= 32.
- Small display text (16-24px) -> TextShadow3D with fontSize between 16 and 24. Validation enforces both limits.
- Supported common icons -> Icon3D.
- Tabs or rotating groups of 3-8 items -> Carousel3D with the items as child nodes.
- Recessed application or window regions -> Chrome3D.
- Semantic containers, forms, inputs, links, and lists -> HtmlElement.
- Navigation links -> HtmlElement "a" with href, or Button3D with a navigate interaction whose destination is the link target.

Page settings:
- Set page.theme from what the source suggests (dark or light). Default to a dark background with light ink and a single accent when the source gives no signal.
- Keep page.title equal to the source title unless it is empty.

Size limits:
- Do not exceed about 120 nodes for very large pages. Group repeated list items into a parent HtmlElement ul (or ol) with representative li children and list the surplus source element IDs in that parent node's sourceElementIds. A single node may list at most 128 source element IDs; spread larger groups across the ul and its li children.`;

export async function createReconstructionSpec(
  parsed: ParsedWebpageUi,
  client: ReconstructionAgentClient,
  hooks: ReconstructionAgentHooks = {},
): Promise<ReconstructionAgentResult> {
  const input = prepareAgentInput(parsed);
  const baseMessages: GrokMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Reconstruct this parsed webpage graph:\n${JSON.stringify(input)}`,
    },
  ];
  const requestOptions = {
    responseFormat: RECONSTRUCTION_RESPONSE_FORMAT,
    ...(hooks.signal ? { signal: hooks.signal } : {}),
  };
  const context = {
    elementIds: parsed.elements.map((element) => element.id),
    connectionIds: parsed.connections.map((connection) => connection.id),
    assetIds: parsed.assets.images.map((asset) => asset.id),
    requireElementCoverage: true,
  };

  const firstResponse = await client.generateText(baseMessages, requestOptions);
  const firstAttempt = parseAndValidate(firstResponse.text, context);
  if (firstAttempt.valid) {
    await hooks.onModelResponse?.(firstResponse);
    return { spec: firstAttempt.spec, response: firstResponse };
  }

  // One repair round: quote the failures back to the model with its previous
  // output so it can return a corrected, complete specification.
  const repairErrors = firstAttempt.errors.slice(0, MAX_REPAIR_ERRORS);
  await hooks.onRepairAttempt?.(repairErrors);
  const repairResponse = await client.generateText(
    [
      ...baseMessages,
      { role: "assistant", content: firstResponse.text },
      { role: "user", content: buildRepairMessage(repairErrors) },
    ],
    requestOptions,
  );
  await hooks.onModelResponse?.(repairResponse);
  const repairAttempt = parseAndValidate(repairResponse.text, context);
  if (repairAttempt.valid) {
    return { spec: repairAttempt.spec, response: repairResponse };
  }

  throw new ReconstructionAgentOutputError(
    repairAttempt.malformed
      ? "Grok returned malformed reconstruction JSON."
      : "Grok returned an invalid reconstruction specification.",
    repairAttempt.errors,
  );
}

type ParseAndValidateResult =
  | { valid: true; spec: ReconstructionSpec }
  | { valid: false; malformed: boolean; errors: string[] };

function parseAndValidate(
  text: string,
  context: Parameters<typeof validateReconstructionSpec>[1],
): ParseAndValidateResult {
  let candidate: unknown;
  try {
    candidate = JSON.parse(text);
  } catch {
    return { valid: false, malformed: true, errors: [MALFORMED_JSON_ERROR] };
  }

  const validation = validateReconstructionSpec(candidate, context);
  if (!validation.valid) {
    return { valid: false, malformed: false, errors: validation.errors };
  }
  return { valid: true, spec: validation.value };
}

function buildRepairMessage(errors: string[]): string {
  const list = errors.map((error) => `- ${error}`).join("\n");
  return `Your previous ReconstructionSpec was rejected by validation with the following errors:\n${list}\n\nReturn a corrected, complete ReconstructionSpec JSON document that fixes every listed error while keeping the same schema, source element coverage, and evidence rules. Return only the JSON.`;
}

/**
 * Builds the compact model input. When the serialized graph exceeds
 * MAX_INPUT_CHARACTERS, every element's `name` and `text` strings are truncated
 * to TRUNCATED_TEXT_LENGTH characters. IDs, hierarchy, connections, and assets
 * are kept intact so the model can still reference every source element; only
 * long copy is shortened to keep the request within a safe size.
 */
function prepareAgentInput(parsed: ParsedWebpageUi) {
  const input = {
    page: parsed.page,
    elements: parsed.elements,
    connections: parsed.connections,
    assets: parsed.assets,
    warnings: parsed.warnings,
  };
  if (JSON.stringify(input).length <= MAX_INPUT_CHARACTERS) {
    return input;
  }

  return {
    ...input,
    elements: parsed.elements.map(truncateElementText),
  };
}

function truncateElementText(element: UiElement): UiElement {
  return {
    ...element,
    ...(element.name !== undefined
      ? { name: truncate(element.name, TRUNCATED_TEXT_LENGTH) }
      : {}),
    ...(element.text !== undefined
      ? { text: truncate(element.text, TRUNCATED_TEXT_LENGTH) }
      : {}),
  };
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}
