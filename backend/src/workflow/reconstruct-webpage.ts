import { randomUUID } from "node:crypto";

import {
  FileImageAssetStore,
  type ImageAssetStore,
} from "../assets/file-image-asset-store";
import {
  createReconstructionSpec,
  ReconstructionAgentOutputError,
  type ReconstructionAgentClient,
} from "../agents/reconstruction-agent";
import { GrokApiError, GrokClient } from "../providers/grok";
import type { ReconstructionSpec } from "../reconstruction/reconstruction-spec";
import { cacheWebpageImages } from "../webpage/cache-webpage-images";
import {
  fetchWebpageSource,
  WebpageSourceError,
} from "../webpage/fetch-webpage-source";
import {
  parseWebpageUi,
  type ParsedWebpageUi,
} from "../webpage/parse-webpage-ui";
import {
  createReconstructionEventEmitter,
  RECONSTRUCTION_HIGHLIGHT_COLOR,
  type ReconstructionEventSink,
  type StreamedSourceElement,
} from "./reconstruction-events";

export interface ReconstructWebpageOptions {
  url: string;
  allowPrivateNetwork?: boolean;
  jobId?: string;
  onEvent?: ReconstructionEventSink;
  client?: ReconstructionAgentClient;
  assetStore?: ImageAssetStore;
}

export interface ReconstructWebpageResult {
  jobId: string;
  parsed: ParsedWebpageUi;
  spec: ReconstructionSpec;
  model: string;
  responseId: string;
}

export async function reconstructWebpage(
  options: ReconstructWebpageOptions,
): Promise<ReconstructWebpageResult> {
  const jobId = options.jobId ?? `job_${randomUUID()}`;
  const emitter = createReconstructionEventEmitter(jobId, options.onEvent);
  const client = options.client ?? new GrokClient();
  const assetStore = options.assetStore ?? new FileImageAssetStore();
  let progress = 0;

  try {
    await emitter.emit("fetching_source", (progress = 2), {
      type: "workflow.status",
      status: "started",
      message: "Fetching webpage source.",
    });
    const source = await fetchWebpageSource(options.url, {
      allowPrivateNetwork: options.allowPrivateNetwork,
    });
    await emitter.emit("fetching_source", (progress = 18), {
      type: "workflow.status",
      status: "completed",
      message: "Webpage source fetched.",
    });

    await emitter.emit("parsing_dom", (progress = 20), {
      type: "workflow.status",
      status: "started",
      message: "Parsing UI elements and interactions.",
    });
    const parsed = parseWebpageUi(source);
    await emitter.emit("parsing_dom", (progress = 35), {
      type: "workflow.status",
      status: "completed",
      message: "UI graph created.",
      counts: {
        elements: parsed.elements.length,
        connections: parsed.connections.length,
      },
    });

    await emitter.emit("caching_assets", (progress = 38), {
      type: "workflow.status",
      status: "started",
      message: "Caching webpage images locally.",
    });
    const withImages = await cacheWebpageImages(source, parsed, assetStore, {
      allowPrivateNetwork: options.allowPrivateNetwork,
    });
    await emitter.emit("caching_assets", (progress = 50), {
      type: "workflow.status",
      status: "completed",
      message: "Local image assets are ready.",
      counts: { images: withImages.assets.images.length },
    });

    await emitter.emit("preparing_agent", (progress = 51), {
      type: "workflow.status",
      status: "started",
      message: "Preparing compact source evidence for reconstruction.",
    });

    for (let index = 0; index < withImages.elements.length; index += 1) {
      const element = withImages.elements[index];
      await emitter.emit("preparing_agent", (progress = 51 + elementProgress(index, withImages.elements.length, 4)), {
        type: "source.element",
        message: "Source UI element prepared.",
        element: toStreamedSourceElement(element),
        focus: {
          sourceElementIds: [element.id],
          reconstructionNodeIds: [],
          assetIds: element.assetId ? [element.assetId] : [],
          highlightColor: RECONSTRUCTION_HIGHLIGHT_COLOR,
        },
        annotation: describeSourceElement(element),
      });
    }

    await emitter.emit("preparing_agent", (progress = 56), {
      type: "workflow.status",
      status: "completed",
      message: "Compact graph prepared for reconstruction.",
      counts: {
        elements: withImages.elements.length,
        connections: withImages.connections.length,
        images: withImages.assets.images.length,
      },
    });
    await emitter.emit("reconstructing", (progress = 60), {
      type: "workflow.status",
      status: "started",
      message: "Mapping the webpage to approved 3DUI components.",
    });

    const agentResult = await createReconstructionSpec(withImages, client, {
      onModelResponse: async () => {
        await emitter.emit("reconstructing", (progress = 78), {
          type: "workflow.status",
          status: "completed",
          message: "The model returned a structured reconstruction.",
        });
        await emitter.emit("validating_spec", (progress = 80), {
          type: "workflow.status",
          status: "started",
          message: "Validating components, evidence, hierarchy, and assets.",
        });
      },
    });
    await emitter.emit("validating_spec", (progress = 84), {
      type: "workflow.status",
      status: "completed",
      message: "Reconstruction specification validated.",
      counts: { nodes: agentResult.spec.nodes.length },
    });

    for (let index = 0; index < agentResult.spec.nodes.length; index += 1) {
      const node = agentResult.spec.nodes[index];
      await emitter.emit("presenting_result", (progress = 85 + elementProgress(index, agentResult.spec.nodes.length, 13)), {
        type: "reconstruction.node",
        message: "Reconstructed UI node ready.",
        node,
        focus: {
          sourceElementIds: node.sourceElementIds,
          reconstructionNodeIds: [node.id],
          assetIds: getNodeAssetIds(node),
          highlightColor: RECONSTRUCTION_HIGHLIGHT_COLOR,
        },
        annotation: `Mapped source UI to ${node.component}.`,
      });
    }

    await emitter.emit("completed", 100, {
      type: "workflow.completed",
      status: "completed",
      message: "Webpage reconstruction is ready.",
      model: agentResult.response.model,
      responseId: agentResult.response.id,
      usage: agentResult.response.usage,
      result: agentResult.spec,
    });

    return {
      jobId,
      parsed: withImages,
      spec: agentResult.spec,
      model: agentResult.response.model,
      responseId: agentResult.response.id,
    };
  } catch (error) {
    const failure = classifyFailure(error);
    try {
      await emitter.emit("failed", progress, {
        type: "workflow.failed",
        status: "failed",
        message: failure.message,
        error: { code: failure.code, retryable: failure.retryable },
      });
    } catch {
      // Preserve the workflow error if the event transport is already closed.
    }
    throw error;
  }
}

function elementProgress(index: number, total: number, span: number): number {
  return total > 0 ? Math.round(((index + 1) / total) * span) : span;
}

function describeSourceElement(element: ParsedWebpageUi["elements"][number]): string {
  const identity = element.name ?? element.text ?? element.role;
  return `Recognized ${element.role} ${JSON.stringify(identity)}.`;
}

function toStreamedSourceElement(
  element: ParsedWebpageUi["elements"][number],
): StreamedSourceElement {
  return {
    id: element.id,
    kind: element.kind,
    tag: element.tag,
    role: element.role,
    name: element.name,
    text: element.text,
    selector: element.selector,
    parentId: element.parentId,
    state: element.state,
    assetId: element.assetId,
  };
}

function getNodeAssetIds(
  node: ReconstructionSpec["nodes"][number],
): string[] {
  return node.component === "Image3D" ? [node.props.assetId] : [];
}

function classifyFailure(error: unknown): {
  code: string;
  message: string;
  retryable: boolean;
} {
  if (error instanceof WebpageSourceError) {
    return {
      code: "SOURCE_FETCH_FAILED",
      message: "The webpage source could not be collected.",
      retryable: false,
    };
  }
  if (error instanceof ReconstructionAgentOutputError) {
    return {
      code: "INVALID_RECONSTRUCTION",
      message: "The reconstruction result did not pass validation.",
      retryable: true,
    };
  }
  if (error instanceof GrokApiError) {
    return {
      code: "MODEL_REQUEST_FAILED",
      message: "The reconstruction model request failed.",
      retryable: error.status === 429 || error.status >= 500,
    };
  }
  return {
    code: "WORKFLOW_FAILED",
    message: "The webpage reconstruction failed.",
    retryable: false,
  };
}
