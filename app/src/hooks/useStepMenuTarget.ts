import { useCallback, useState, type MutableRefObject } from "react";
import type { CanvasNode } from "../types/CanvasNode";
import type { UseStepMenuTargetResult } from "../types/UseStepMenuTargetResult";

/**
 * The step a step-menu action's dialog is open for: offered only on the steps
 * `eligible` accepts, and read from the canvas's latest nodes so the dialog
 * sees the step as it is now.
 */
export function useStepMenuTarget(
  nodesRef: MutableRefObject<CanvasNode[]>,
  eligible: (node: CanvasNode) => boolean,
): UseStepMenuTargetResult {
  const [nodeId, setNodeId] = useState<string | null>(null);
  const node = nodeId === null ? undefined : nodesRef.current.find((candidate) => candidate.id === nodeId);

  const can = useCallback(
    (id: string) => {
      const candidate = nodesRef.current.find((each) => each.id === id);
      return candidate !== undefined && eligible(candidate);
    },
    [nodesRef, eligible],
  );

  const close = useCallback(() => setNodeId(null), []);

  const take = useCallback(() => {
    setNodeId(null);
    return nodeId;
  }, [nodeId]);

  return { nodeId, node, can, start: setNodeId, close, take };
}
