import type { Node } from "@xyflow/react";
import type { WorkflowCanvasNodeData } from "../types/WorkflowCanvasNodeData";
import { analyzeVariableProvenance } from "@shared/analysis/workflow_graph_analyzer";
import type { VariableProvenanceMap } from "@shared/types/VariableProvenanceMap";

/**
 * Build a provenance map over the canvas nodes: for each variable, the node +
 * extractor path that produced it (producers) and the nodes + fields that
 * reference it via {{variables.NAME}} (consumers). Read-only over the graph.
 */
export function computeProvenance(
  nodes: readonly Node<WorkflowCanvasNodeData>[],
): VariableProvenanceMap {
  return analyzeVariableProvenance(
    nodes.map((node) => ({
      nodeId: node.id,
      label: node.data?.label ?? node.id,
      ...(node.data?.config === undefined ? {} : { config: node.data.config }),
    })),
  );
}
