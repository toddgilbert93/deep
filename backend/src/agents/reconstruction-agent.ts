import type {
  GrokClient,
  GrokMessage,
  GrokTextResponse,
} from "../providers/grok";
import type { ReconstructionSpec } from "../reconstruction/reconstruction-spec";
import { RECONSTRUCTION_RESPONSE_FORMAT } from "../reconstruction/reconstruction-spec-schema";
import { validateReconstructionSpec } from "../reconstruction/validate-reconstruction-spec";
import type { ParsedWebpageUi } from "../webpage/parse-webpage-ui";

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
  onModelResponse?: (response: GrokTextResponse) => void | Promise<void>;
}

export class ReconstructionAgentOutputError extends Error {
  readonly validationErrors: string[];

  constructor(message: string, validationErrors: string[] = []) {
    super(message);
    this.name = "ReconstructionAgentOutputError";
    this.validationErrors = validationErrors;
  }
}

const SYSTEM_PROMPT = `You are Deep's webpage reconstruction planner.

Create an evidence-linked plan for rebuilding the supplied webpage as a similar 3D webpage. Return only the requested ReconstructionSpec JSON.

Rules:
- Use only the component names and props allowed by the supplied JSON Schema.
- Preserve source hierarchy, visible content, navigation, forms, accessibility semantics, interactions, and locally cached images.
- Use Image3D only with an assetId present in the input graph.
- Prefer the approved 3DUI components. Use HtmlElement only for semantic layout, form fields, links, lists, and other behavior the 3DUI library does not provide.
- Every source element must appear in at least one node.sourceElementIds entry or in unresolved with a concrete reason.
- Every claimed source element, connection, and asset ID must exist in the input.
- Do not generate React, CSS, HTML source code, markdown, analysis, or model reasoning.`;

export async function createReconstructionSpec(
  parsed: ParsedWebpageUi,
  client: ReconstructionAgentClient,
  hooks: ReconstructionAgentHooks = {},
): Promise<ReconstructionAgentResult> {
  const input = {
    page: parsed.page,
    elements: parsed.elements,
    connections: parsed.connections,
    assets: parsed.assets,
    warnings: parsed.warnings,
  };
  const response = await client.generateText(
    [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Reconstruct this parsed webpage graph:\n${JSON.stringify(input)}`,
      },
    ],
    { responseFormat: RECONSTRUCTION_RESPONSE_FORMAT },
  );
  await hooks.onModelResponse?.(response);

  let candidate: unknown;
  try {
    candidate = JSON.parse(response.text);
  } catch {
    throw new ReconstructionAgentOutputError(
      "Grok returned malformed reconstruction JSON.",
    );
  }

  const validation = validateReconstructionSpec(candidate, {
    elementIds: parsed.elements.map((element) => element.id),
    connectionIds: parsed.connections.map((connection) => connection.id),
    assetIds: parsed.assets.images.map((asset) => asset.id),
    requireElementCoverage: true,
  });
  if (!validation.valid) {
    throw new ReconstructionAgentOutputError(
      "Grok returned an invalid reconstruction specification.",
      validation.errors,
    );
  }

  return { spec: validation.value, response };
}
