import Ajv2020 from "ajv/dist/2020";
import type { ErrorObject } from "ajv";

import {
  type ReconstructionReferenceContext,
  type ReconstructionSpec,
  type ReconstructionValidationResult,
} from "./reconstruction-spec";
import { RECONSTRUCTION_SPEC_SCHEMA } from "./reconstruction-spec-schema";

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateShape = ajv.compile<ReconstructionSpec>(RECONSTRUCTION_SPEC_SCHEMA);

export function validateReconstructionSpec(
  value: unknown,
  context?: ReconstructionReferenceContext,
): ReconstructionValidationResult {
  if (!validateShape(value)) {
    return {
      valid: false,
      errors: (validateShape.errors ?? []).map(formatAjvError),
    };
  }

  const errors = validateReferences(value, context);
  return errors.length
    ? { valid: false, errors }
    : { valid: true, value };
}

export function assertReconstructionSpec(
  value: unknown,
  context?: ReconstructionReferenceContext,
): asserts value is ReconstructionSpec {
  const result = validateReconstructionSpec(value, context);
  if (!result.valid) {
    throw new Error(
      `Invalid reconstruction specification:\n- ${result.errors.join("\n- ")}`,
    );
  }
}

function validateReferences(
  spec: ReconstructionSpec,
  context?: ReconstructionReferenceContext,
): string[] {
  const errors: string[] = [];
  const nodes = new Map<string, (typeof spec.nodes)[number]>();
  const interactionIds = new Set<string>();

  for (const node of spec.nodes) {
    if (nodes.has(node.id)) {
      errors.push(`Duplicate node id: ${node.id}.`);
    }
    nodes.set(node.id, node);
  }

  for (const node of spec.nodes) {
    if (node.parentId && !nodes.has(node.parentId)) {
      errors.push(`Node ${node.id} references missing parent ${node.parentId}.`);
    }
    if (node.parentId === node.id) {
      errors.push(`Node ${node.id} cannot parent itself.`);
    }

    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent?.component === "Button3DGroup" && node.component !== "Button3D") {
      errors.push(`Button3DGroup ${parent.id} may contain only Button3D children.`);
    }

    if (node.component === "Image3D" && context) {
      const assetIds = toSet(context.assetIds);
      if (!assetIds.has(node.props.assetId)) {
        errors.push(
          `Image node ${node.id} references unknown asset ${node.props.assetId}.`,
        );
      }
    }
  }

  errors.push(...findParentCycles(spec));

  for (const interaction of spec.interactions) {
    if (interactionIds.has(interaction.id)) {
      errors.push(`Duplicate interaction id: ${interaction.id}.`);
    }
    interactionIds.add(interaction.id);

    if (!nodes.has(interaction.sourceNodeId)) {
      errors.push(
        `Interaction ${interaction.id} references missing source node ${interaction.sourceNodeId}.`,
      );
    }
    if (interaction.targetNodeId && !nodes.has(interaction.targetNodeId)) {
      errors.push(
        `Interaction ${interaction.id} references missing target node ${interaction.targetNodeId}.`,
      );
    }
  }

  if (context) {
    validateSourceReferences(spec, context, errors);
  }

  return [...new Set(errors)];
}

function validateSourceReferences(
  spec: ReconstructionSpec,
  context: ReconstructionReferenceContext,
  errors: string[],
): void {
  const elementIds = toSet(context.elementIds);
  const connectionIds = toSet(context.connectionIds);
  const accountedForElements = new Set<string>();

  for (const node of spec.nodes) {
    for (const id of node.sourceElementIds) {
      accountedForElements.add(id);
      if (!elementIds.has(id)) {
        errors.push(`Node ${node.id} references unknown source element ${id}.`);
      }
    }
    for (const id of node.evidence.sourceConnectionIds) {
      if (!connectionIds.has(id)) {
        errors.push(`Node ${node.id} references unknown source connection ${id}.`);
      }
    }
  }

  for (const interaction of spec.interactions) {
    for (const id of interaction.sourceConnectionIds) {
      if (!connectionIds.has(id)) {
        errors.push(
          `Interaction ${interaction.id} references unknown source connection ${id}.`,
        );
      }
    }
  }

  for (const unresolved of spec.unresolved) {
    accountedForElements.add(unresolved.sourceElementId);
    if (!elementIds.has(unresolved.sourceElementId)) {
      errors.push(
        `Unresolved entry references unknown source element ${unresolved.sourceElementId}.`,
      );
    }
  }

  if (context.requireElementCoverage) {
    for (const id of elementIds) {
      if (!accountedForElements.has(id)) {
        errors.push(`Source element ${id} is neither reconstructed nor unresolved.`);
      }
    }
  }
}

function findParentCycles(spec: ReconstructionSpec): string[] {
  const parentById = new Map(
    spec.nodes.map((node) => [node.id, node.parentId] as const),
  );
  const errors: string[] = [];

  for (const startId of parentById.keys()) {
    const visited = new Set<string>();
    let currentId: string | undefined = startId;
    while (currentId) {
      if (visited.has(currentId)) {
        errors.push(`Node hierarchy contains a cycle involving ${currentId}.`);
        break;
      }
      visited.add(currentId);
      currentId = parentById.get(currentId);
    }
  }

  return errors;
}

function toSet(values: ReadonlySet<string> | readonly string[]): ReadonlySet<string> {
  return values instanceof Set ? values : new Set(values);
}

function formatAjvError(error: ErrorObject): string {
  const location = error.instancePath || "/";
  return `${location} ${error.message ?? "is invalid"}`;
}
