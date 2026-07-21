import { useEffect, useRef, useState } from "react";
import type { Workflow } from "@shared/types/Workflow";
import type { Node, Edge } from "reactflow";
import { workflowToCanvas } from "../adapters/workflowCanvas";
import type { WorkflowCanvasNodeData } from "../types/WorkflowCanvasNodeData";
import type { WorkflowCanvasEdgeData } from "../types/WorkflowCanvasEdgeData";
import type { HydratedBaseline } from "../types/HydratedBaseline";

interface UseHydrationParams {
  workflow: Workflow | null | undefined;
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
  const lastContentSigRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      !workflow ||
      !Array.isArray(workflow.nodes) ||
      !Array.isArray(workflow.edges)
    ) {
      setIsHydrated(false);
      lastContentSigRef.current = null;
      return;
    }

    // The tab's workflow object identity changes after every save (the server
    // bumps rev/updatedAt and we write the echo back). Re-hydrating on those
    // rev-only changes rebuilds node.data references, which the autosave
    // signature reads as an edit — a false-dirty save/sync loop. Skip
    // re-hydration when the actual content is unchanged.
    const content = { ...workflow } as Partial<Workflow>;
    delete content.rev;
    delete content.updatedAt;
    const contentSig = JSON.stringify(content);
    if (contentSig === lastContentSigRef.current) return;
    lastContentSigRef.current = contentSig;

    const { nodes: loadedNodes, edges: loadedEdges } =
      workflowToCanvas(workflow);

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
