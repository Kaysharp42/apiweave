import { useEffect, useMemo } from "react";
import type { Node, Edge } from "reactflow";
import type { WorkflowCanvasNodeData } from "../types/WorkflowCanvasNodeData";
import type { WorkflowCanvasEdgeData } from "../types/WorkflowCanvasEdgeData";

interface UseNodeBranchCountsParams {
  edges: Edge<WorkflowCanvasEdgeData>[];
  nodes: Node<WorkflowCanvasNodeData>[];
  setNodes: React.Dispatch<
    React.SetStateAction<Node<WorkflowCanvasNodeData>[]>
  >;
}

export function useNodeBranchCounts({
  edges,
  nodes,
  setNodes,
}: UseNodeBranchCountsParams) {
  const nodeLabelSignature = useMemo(
    () => nodes.map((n) => `${n.id}:${n.data?.label ?? ""}`).join("|"),
    [nodes],
  );

  useEffect(() => {
    const branchCounts: Record<string, number> = {};
    edges.forEach((edge) => {
      branchCounts[edge.source] = (branchCounts[edge.source] || 0) + 1;
    });

    const incomingCounts: Record<string, number> = {};
    const incomingEdgesMap: Record<string, Edge<WorkflowCanvasEdgeData>[]> = {};
    edges.forEach((edge) => {
      incomingCounts[edge.target] = (incomingCounts[edge.target] || 0) + 1;
      if (!incomingEdgesMap[edge.target]) {
        incomingEdgesMap[edge.target] = [];
      }
      incomingEdgesMap[edge.target]!.push(edge);
    });

    const branchesEqual = (
      left:
        | Array<{
            index: number;
            nodeId: string;
            label: string;
            edgeLabel: string;
          }>
        | undefined,
      right:
        | Array<{
            index: number;
            nodeId: string;
            label: string;
            edgeLabel: string;
          }>
        | undefined,
    ): boolean => {
      if (left === right) return true;
      if (!left || !right) return false;
      if (left.length !== right.length) return false;
      for (let i = 0; i < left.length; i += 1) {
        const l = left[i]!;
        const r = right[i]!;
        if (
          l.index !== r.index ||
          l.nodeId !== r.nodeId ||
          l.label !== r.label ||
          l.edgeLabel !== r.edgeLabel
        ) {
          return false;
        }
      }
      return true;
    };

    setNodes((nds) => {
      let didChange = false;
      const nextNodes = nds.map((node) => {
        const nextBranchCount = branchCounts[node.id] || 0;
        const nextIncomingBranchCount = incomingCounts[node.id] || 0;
        const prevData = node.data || {};

        let nextIncomingBranches = prevData.incomingBranches;
        let incomingBranchesChanged = false;

        if (node.type === "merge" && incomingEdgesMap[node.id]) {
          nextIncomingBranches = incomingEdgesMap[node.id]!.map((edge, idx) => {
            const sourceNode = nds.find((n) => n.id === edge.source);
            return {
              index: idx,
              nodeId: edge.source,
              label: sourceNode?.data?.label || edge.source,
              edgeLabel: (edge.label as string) || `Branch ${idx}`,
            };
          });
          incomingBranchesChanged = !branchesEqual(
            prevData.incomingBranches,
            nextIncomingBranches,
          );
        }

        const baseChanged =
          prevData.branchCount !== nextBranchCount ||
          prevData.incomingBranchCount !== nextIncomingBranchCount;

        if (!baseChanged && !incomingBranchesChanged) {
          return node;
        }

        didChange = true;
        return {
          ...node,
          data: {
            ...prevData,
            branchCount: nextBranchCount,
            incomingBranchCount: nextIncomingBranchCount,
            ...(incomingBranchesChanged
              ? { incomingBranches: nextIncomingBranches }
              : {}),
          },
        };
      });

      return didChange ? nextNodes : nds;
    });
  }, [edges, nodeLabelSignature, setNodes]);
}
