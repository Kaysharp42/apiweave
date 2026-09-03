import type { Workflow } from "@shared/types/Workflow";
import { WorkflowEdgeSchema } from "@shared/zod-schemas/WorkflowEdgeSchema";
import { WorkflowNodeSchema } from "@shared/zod-schemas/WorkflowNodeSchema";
import { WorkflowSchema } from "@shared/zod-schemas/WorkflowSchema";
import type { Edge, Node } from "@xyflow/react";
import {
  FRAME_FALLBACK_HEIGHT,
  FRAME_FALLBACK_WIDTH,
  FRAME_NODE_TYPE,
  isFrameNode,
  reconcileFrames,
} from "../utils/canvasGroups";
import type { CanvasWorkflowState } from "../types/CanvasWorkflowState";
import type { WorkflowCanvasEdgeData } from "../types/WorkflowCanvasEdgeData";
import type { WorkflowCanvasNodeData } from "../types/WorkflowCanvasNodeData";

export function workflowToCanvas(workflow: Workflow): CanvasWorkflowState {
  const nodes: Node<WorkflowCanvasNodeData>[] = workflow.nodes.map((node) => {
    const config = (node.config ?? {}) as Record<string, unknown>;
    return {
      id: node.nodeId,
      type: node.type,
      position: node.position,
      // `extent` is not persisted — it is the same fact as `parentId`, and a
      // child free to leave its frame is not in it.
      ...(node.parentId === undefined
        ? {}
        : { parentId: node.parentId, extent: "parent" as const }),
      // A frame's size is document, not measurement: React Flow reads it off
      // `width`/`height`, which is also where `NodeResizer` writes.
      ...(node.type === FRAME_NODE_TYPE
        ? {
            width:
              typeof config.width === "number"
                ? config.width
                : FRAME_FALLBACK_WIDTH,
            height:
              typeof config.height === "number"
                ? config.height
                : FRAME_FALLBACK_HEIGHT,
            dragHandle: ".aw-group-handle",
          }
        : {}),
      data: {
        ...(node.label === undefined ? {} : { label: node.label }),
        config: node.config ?? {},
      },
    };
  });

  const edges: Edge<WorkflowCanvasEdgeData>[] = workflow.edges.map((edge) => ({
    id: edge.edgeId,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? null,
    targetHandle: edge.targetHandle ?? null,
    label: edge.label,
    type: "custom",
    // Deliberately no `style`, and no `animated`. Both are appearance the
    // canvas has to *earn*: `animated` marched every branch edge forever on a
    // workflow that had never run, and `style.stroke` painted pass branches in
    // the success token, which reads as "this path ran and passed" before
    // anything has run at all. `CustomEdge` takes colour from live run state
    // only; the branch is identified by the socket the edge leaves.
  }));

  return {
    // Frames to the front, and any `parentId` the cloud merge left dangling
    // dropped before React Flow ever sees it.
    nodes: reconcileFrames(nodes),
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
      ...(node.parentId === undefined ? {} : { parentId: node.parentId }),
      ...(typeof node.data.label === "string" || node.data.label === null
        ? { label: node.data.label }
        : {}),
      config: isFrameNode(node)
        ? {
            ...(node.data.config ?? {}),
            width: node.width ?? FRAME_FALLBACK_WIDTH,
            height: node.height ?? FRAME_FALLBACK_HEIGHT,
          }
        : (node.data.config ?? {}),
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
