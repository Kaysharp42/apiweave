import { useCallback, useEffect, useState } from "react";
import type { CanvasNode } from "../types/CanvasNode";
import type { UseStepMenuTargetResult } from "../types/UseStepMenuTargetResult";

/**
 * The step a step-menu action's dialog is open for: offered only on the steps
 * `eligible` accepts, and read from the canvas's committed nodes so the dialog
 * sees the step as it is now. A step that is deleted, or that `eligible`
 * stops accepting while its dialog is open, releases the target, so taking
 * the action on that step again opens a fresh dialog instead of changing no
 * state and silently doing nothing.
 */
export function useStepMenuTarget(
  nodes: readonly CanvasNode[],
  eligible: (node: CanvasNode) => boolean,
): UseStepMenuTargetResult {
  const [nodeId, setNodeId] = useState<string | null>(null);
  const node = nodeId === null ? undefined : nodes.find((candidate) => candidate.id === nodeId);

  // A target that no longer exists, or that the action no longer applies to,
  // is not open. Left set, it would make the next start() on that step a
  // no-op, and the dialog — keyed by node — would keep its stale state.
  useEffect(() => {
    if (nodeId !== null && (node === undefined || !eligible(node))) setNodeId(null);
  }, [nodeId, node, eligible]);

  const can = useCallback(
    (id: string) => {
      const candidate = nodes.find((each) => each.id === id);
      return candidate !== undefined && eligible(candidate);
    },
    [nodes, eligible],
  );

  const close = useCallback(() => setNodeId(null), []);

  const take = useCallback(() => {
    setNodeId(null);
    return nodeId;
  }, [nodeId]);

  return { nodeId, node, can, start: setNodeId, close, take };
}
