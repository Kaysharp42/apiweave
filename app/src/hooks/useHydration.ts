import { useCallback, useEffect, useRef, useState } from "react";
import type { Workflow } from "@shared/types/Workflow";
import type { Node, Edge } from "@xyflow/react";
import { workflowToCanvas } from "../adapters/workflowCanvas";
import type { WorkflowCanvasNodeData } from "../types/WorkflowCanvasNodeData";
import type { WorkflowCanvasEdgeData } from "../types/WorkflowCanvasEdgeData";
import type { HydratedBaseline } from "../types/HydratedBaseline";

// The only two `data` fields `workflowToCanvas` rebuilds from persisted state.
// Everything else a node carries — the last run's status/result, the branch
// counts, the swagger warning — exists nowhere but the live canvas.
const PERSISTED_NODE_DATA_KEYS = new Set(["label", "config"]);

/**
 * Carry the canvas-only half of `node.data` across a re-hydration.
 *
 * Re-hydration replaces every node object, and `workflowToCanvas` builds `data`
 * from the persisted fields alone — so on its own it erases the run the user is
 * looking at. That is what made a finished run vanish a few seconds later: the
 * first save whose echo carried a real content change repainted the whole
 * canvas grey (statuses, response summaries, edge colours, branch badges), and
 * the results were only reachable again by reopening the run from History.
 *
 * Persisted fields still win. Only nodes that survived the reload keep their
 * canvas state; nodes the reload removed are simply gone.
 */
export function preserveCanvasRuntimeState(
  loadedNodes: Node<WorkflowCanvasNodeData>[],
  previousNodes: Node<WorkflowCanvasNodeData>[],
): Node<WorkflowCanvasNodeData>[] {
  if (previousNodes.length === 0) return loadedNodes;

  const previousDataById = new Map(
    previousNodes.map((node) => [node.id, node.data]),
  );

  return loadedNodes.map((node) => {
    const previousData = previousDataById.get(node.id);
    if (!previousData) return node;

    const canvasOnly: WorkflowCanvasNodeData = {};
    let hasCanvasOnly = false;
    for (const [key, value] of Object.entries(previousData)) {
      if (PERSISTED_NODE_DATA_KEYS.has(key)) continue;
      canvasOnly[key] = value;
      hasCanvasOnly = true;
    }
    if (!hasCanvasOnly) return node;

    return { ...node, data: { ...canvasOnly, ...node.data } };
  });
}

/** What the canvas renders, minus the fields the server bumps on every write. */
function workflowContentSignature(workflow: Workflow): string {
  const content = { ...workflow } as Partial<Workflow>;
  delete content.rev;
  delete content.updatedAt;
  return JSON.stringify(content);
}

interface UseHydrationParams {
  workflow: Workflow | null | undefined;
  /** The canvas's committed state, to learn when it has caught up with a hydration. */
  nodes: Node<WorkflowCanvasNodeData>[];
  edges: Edge<WorkflowCanvasEdgeData>[];
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
  /**
   * Record the graph just handed to `setNodes`/`setEdges` as the baseline.
   * Call it only right after queuing new node/edge arrays: it holds silent
   * saves back until the next commit of `nodes`/`edges`.
   */
  setHydratedBaseline: (baseline: HydratedBaseline) => void;
  /**
   * False from the moment a baseline is set until the canvas commits the graph
   * it describes. An autosave in that window reads the previous canvas state
   * (`nodesRef` follows commits, not `setNodes` calls) and would write it over
   * the workflow the baseline describes.
   */
  canvasMatchesBaseline: () => boolean;
  noteSavedWorkflow: (savedWorkflow: Workflow) => void;
}

export function useHydration({
  workflow,
  nodes,
  edges,
  setNodes,
  setEdges,
}: UseHydrationParams): UseHydrationReturn {
  const [isHydrated, setIsHydrated] = useState(false);
  const hydratedBaselineRef = useRef<HydratedBaseline | null>(null);
  const lastContentSigRef = useRef<string | null>(null);
  const canvasBehindBaselineRef = useRef(false);

  const setHydratedBaseline = useCallback((baseline: HydratedBaseline) => {
    hydratedBaselineRef.current = baseline;
    canvasBehindBaselineRef.current = true;
  }, []);

  const canvasMatchesBaseline = useCallback(
    () => !canvasBehindBaselineRef.current,
    [],
  );

  // Every call that sets a baseline has just queued `setNodes`/`setEdges` with
  // new arrays, and React applies queued updates in the next render, so the
  // next commit that changes `nodes` or `edges` is the one carrying that graph.
  // This effect must stay declared before the hydration effect: when both run
  // in one commit, the commit that triggered hydration is not the one that
  // shows it, and the flag the hydration effect sets afterwards must survive.
  useEffect(() => {
    canvasBehindBaselineRef.current = false;
  }, [nodes, edges]);

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
    const contentSig = workflowContentSignature(workflow);
    if (contentSig === lastContentSigRef.current) return;
    lastContentSigRef.current = contentSig;

    const { nodes: loadedNodes, edges: loadedEdges } =
      workflowToCanvas(workflow);

    setNodes((previousNodes) =>
      preserveCanvasRuntimeState(loadedNodes, previousNodes),
    );
    setEdges(loadedEdges);
    setIsHydrated(true);
    setHydratedBaseline({
      nodeCount: loadedNodes.length,
      edgeCount: loadedEdges.length,
    });
  }, [workflow, setNodes, setEdges, setHydratedBaseline]);

  /**
   * Record the workflow a save just echoed back as content the canvas already
   * shows. Our own save carries our own edits, so its echo *is* a content
   * change by the check above — which is how a plain autosave (the one that
   * fires the moment a run re-enables it) ended up re-hydrating the canvas
   * from its own PATCH response, discarding both the run state
   * `preserveCanvasRuntimeState` now rescues and any edit made while the
   * request was in flight.
   */
  const noteSavedWorkflow = useCallback((savedWorkflow: Workflow) => {
    lastContentSigRef.current = workflowContentSignature(savedWorkflow);
  }, []);

  return {
    isHydrated,
    hydratedBaselineRef,
    setHydratedBaseline,
    canvasMatchesBaseline,
    noteSavedWorkflow,
  };
}
