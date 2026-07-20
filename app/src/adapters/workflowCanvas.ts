import type { Workflow } from "@shared/types/Workflow";
import { WorkflowEdgeSchema } from "@shared/zod-schemas/WorkflowEdgeSchema";
import { WorkflowNodeSchema } from "@shared/zod-schemas/WorkflowNodeSchema";
import { WorkflowSchema } from "@shared/zod-schemas/WorkflowSchema";
import type { Edge, Node } from "reactflow";
import type { CanvasWorkflowState } from "../types/CanvasWorkflowState";
import type { WorkflowCanvasEdgeData } from "../types/WorkflowCanvasEdgeData";
import type { WorkflowCanvasNodeData } from "../types/WorkflowCanvasNodeData";

export const assertionEdgeColor = (
  sourceHandle: string | null | undefined,
): string =>
  sourceHandle === "pass"
    ? "var(--aw-status-success)"
    : "var(--aw-status-error)";

export const edgeLabelBackground = "var(--aw-surface-raised)";

export function workflowToCanvas(workflow: Workflow): CanvasWorkflowState {
  const nodes: Node<WorkflowCanvasNodeData>[] = workflow.nodes.map((node) => ({
    id: node.nodeId,
    type: node.type,
    position: node.position,
    data: {
      ...(node.label === undefined ? {} : { label: node.label }),
      config: node.config ?? {},
    },
  }));

  const edges: Edge<WorkflowCanvasEdgeData>[] = workflow.edges.map((edge) => ({
    id: edge.edgeId,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? null,
    targetHandle: edge.targetHandle ?? null,
    label: edge.label,
    type: "custom",
    ...(edge.sourceHandle === "pass" || edge.sourceHandle === "fail"
      ? {
          animated: true,
          style: {
            stroke: assertionEdgeColor(edge.sourceHandle),
            strokeWidth: 2,
          },
          labelStyle: {
            fill: assertionEdgeColor(edge.sourceHandle),
            fontWeight: 700,
            fontSize: 11,
          },
          labelBgStyle: {
            fill: edgeLabelBackground,
            fillOpacity: 0.95,
          },
          labelBgPadding: [6, 4] as [number, number],
          labelBgBorderRadius: 4,
        }
      : {}),
  }));

  return {
    nodes,
    edges,
    variables: { ...workflow.variables },
    selectedEnvironmentId: workflow.selectedEnvironmentId ?? null,
  };
}

export function canvasToWorkflow(
  canvasState: CanvasWorkflowState,
  existingWorkflow: Workflow,
): Workflow {
  const nodes = canvasState.nodes.map((node) =>
    WorkflowNodeSchema.parse({
      nodeId: node.id,
      type: node.type,
      position: node.position,
      ...(typeof node.data.label === "string" || node.data.label === null
        ? { label: node.data.label }
        : {}),
      config: node.data.config ?? {},
    }),
  );

  const edges = canvasState.edges.map((edge) => {
    const dataLabel = edge.data?.label;
    const label =
      typeof edge.label === "string" || edge.label === null
        ? edge.label
        : typeof dataLabel === "string" || dataLabel === null
          ? dataLabel
          : undefined;

    return WorkflowEdgeSchema.parse({
      edgeId: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
      ...(label === undefined ? {} : { label }),
    });
  });

  return WorkflowSchema.parse({
    ...existingWorkflow,
    nodes,
    edges,
    variables: canvasState.variables,
    selectedEnvironmentId: canvasState.selectedEnvironmentId,
  });
}
