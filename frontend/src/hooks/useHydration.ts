import { useEffect, useRef, useState } from "react";
import type { Node, Edge } from "reactflow";
import type { WorkflowCanvasNodeData } from "../types/WorkflowCanvasNodeData";
import type { WorkflowCanvasEdgeData } from "../types/WorkflowCanvasEdgeData";
import type { WorkflowCanvasWorkflow } from "../types/WorkflowCanvasWorkflow";
import type { HydratedBaseline } from "../types/HydratedBaseline";

const assertionEdgeColor = (sourceHandle: string | null | undefined): string =>
  sourceHandle === "pass"
    ? "var(--aw-status-success)"
    : "var(--aw-status-error)";

const edgeLabelBackground = "var(--aw-surface-raised)";

interface UseHydrationParams {
  workflow: WorkflowCanvasWorkflow | null | undefined;
  setNodes: React.Dispatch<
    React.SetStateAction<Node<WorkflowCanvasNodeData>[]>
  >;
  setEdges: React.Dispatch<
    React.SetStateAction<Edge<WorkflowCanvasEdgeData>[]>
  >;
}

interface UseHydrationReturn {
  isHydrated: boolean;
  hydratedBaselineRef: React.MutableRefObject<HydratedBaseline | null>;
}

export function useHydration({
  workflow,
  setNodes,
  setEdges,
}: UseHydrationParams): UseHydrationReturn {
  const [isHydrated, setIsHydrated] = useState(false);
  const hydratedBaselineRef = useRef<HydratedBaseline | null>(null);

  useEffect(() => {
    if (
      !workflow ||
      !Array.isArray(workflow.nodes) ||
      !Array.isArray(workflow.edges)
    ) {
      setIsHydrated(false);
      return;
    }

    const loadedNodes = workflow.nodes.map((node, index) => ({
      id: node.nodeId ?? node.id ?? `node-${index}`,
      type: node.type ?? "http-request",
      position: node.position,
      data: {
        label: node.label ?? node.data?.label,
        config: node.config ?? node.data?.config ?? {},
      },
    })) as Node<WorkflowCanvasNodeData>[];

    const loadedEdges = workflow.edges.map((edge, index) => ({
      id: edge.edgeId ?? edge.id ?? `edge-${index}`,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle || null,
      targetHandle: edge.targetHandle || null,
      label: edge.label,
      type: "custom",
      ...(edge.sourceHandle === "pass" || edge.sourceHandle === "fail"
        ? {
            animated: true,
            style: {
              stroke:
                edge.sourceHandle === "pass"
                  ? assertionEdgeColor("pass")
                  : assertionEdgeColor("fail"),
              strokeWidth: 2,
            },
            labelStyle: {
              fill:
                edge.sourceHandle === "pass"
                  ? assertionEdgeColor("pass")
                  : assertionEdgeColor("fail"),
              fontWeight: 700,
              fontSize: 11,
            },
            labelBgStyle: {
              fill: edgeLabelBackground,
              fillOpacity: 0.95,
            },
            labelBgPadding: [6, 4],
            labelBgBorderRadius: 4,
          }
        : {}),
    })) as Edge<WorkflowCanvasEdgeData>[];

    setNodes(loadedNodes);
    setEdges(loadedEdges);
    setIsHydrated(true);
    hydratedBaselineRef.current = {
      nodeCount: loadedNodes.length,
      edgeCount: loadedEdges.length,
    };
  }, [workflow, setNodes, setEdges]);

  return { isHydrated, hydratedBaselineRef };
}

export { assertionEdgeColor, edgeLabelBackground };
