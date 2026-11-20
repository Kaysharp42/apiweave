import { useCallback, useMemo, useRef, useState } from "react";
import type { Edge, Node } from "@xyflow/react";
import {
  nextNodeSteps,
  previousStepsFor,
  trailAfterStep,
} from "../utils/nodeNavigation";
import type { NodeStep } from "../types/NodeStep";
import type { NodeStepDirection } from "../types/NodeStepDirection";
import type { UseNodeEditorWalkResult } from "../types/UseNodeEditorWalkResult";
import type { WorkflowCanvasNodeData } from "../types/WorkflowCanvasNodeData";

type CanvasNode = Node<WorkflowCanvasNodeData>;

/**
 * The node editor's walk through the graph: which node it shows, the nodes it
 * stepped forward from (Previous goes back along them, the way Back does in a
 * browser), and the node it was opened on, so closing after a walk can tell
 * the canvas where it ended.
 */
export function useNodeEditorWalk(
  nodes: readonly CanvasNode[],
  edges: readonly Edge[],
): UseNodeEditorWalkResult {
  const [modalNode, setModalNode] = useState<CanvasNode | null>(null);
  const [trail, setTrail] = useState<string[]>([]);
  const [arrivedBy, setArrivedBy] = useState<NodeStepDirection | null>(null);
  const originIdRef = useRef<string | null>(null);
  const modalNodeId = modalNode?.id ?? null;

  const openNodeEditor = useCallback((node: CanvasNode) => {
    originIdRef.current = node.id;
    setTrail([]);
    setArrivedBy(null);
    setModalNode(node);
  }, []);

  const onStep = useCallback(
    (direction: NodeStepDirection, step: NodeStep) => {
      const target = nodes.find((node) => node.id === step.nodeId);
      if (modalNodeId === null || !target) return;
      setTrail((current) => trailAfterStep(current, modalNodeId, target.id, direction));
      setArrivedBy(direction);
      setModalNode(target);
    },
    [nodes, modalNodeId],
  );

  const closeNodeEditor = useCallback(() => {
    setModalNode(null);
    setTrail([]);
    setArrivedBy(null);
    return modalNodeId !== originIdRef.current ? modalNodeId : null;
  }, [modalNodeId]);

  const steps = useMemo(
    () => ({
      previous: modalNodeId === null ? [] : previousStepsFor(nodes, edges, modalNodeId, trail),
      next: modalNodeId === null ? [] : nextNodeSteps(nodes, edges, modalNodeId),
      arrivedBy,
      onStep,
    }),
    [nodes, edges, modalNodeId, trail, arrivedBy, onStep],
  );

  return { modalNode, steps, openNodeEditor, closeNodeEditor };
}
