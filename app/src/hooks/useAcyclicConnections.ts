import { useCallback } from "react";
import { toast } from "sonner";
import { wouldCreateCycle } from "@shared/analysis/workflow_graph_analyzer";

/**
 * Refuse a connection that would close a cycle. A workflow runs each node
 * once and has no loops, and the runner fails a cyclic graph before sending
 * anything. `isValidConnection` marks the target handle invalid while the
 * edge is dragged; `onConnectEnd` says why when it is dropped there anyway.
 */
export function useAcyclicConnections(edgesRef: {
  readonly current: readonly { readonly source: string; readonly target: string }[];
}) {
  const isValidConnection = useCallback(
    (connection: { readonly source: string; readonly target: string }): boolean =>
      !wouldCreateCycle(edgesRef.current, connection.source, connection.target),
    [edgesRef],
  );

  const onConnectEnd = useCallback(
    (
      _event: MouseEvent | TouchEvent,
      state: {
        readonly isValid: boolean | null;
        readonly fromNode: { readonly id: string } | null;
        readonly toNode: { readonly id: string } | null;
        readonly fromHandle: { readonly type: "source" | "target" } | null;
      },
    ): void => {
      if (state.isValid !== false || !state.fromNode || !state.toNode) return;
      const fromSource = state.fromHandle?.type !== "target";
      const source = fromSource ? state.fromNode.id : state.toNode.id;
      const target = fromSource ? state.toNode.id : state.fromNode.id;
      if (!wouldCreateCycle(edgesRef.current, source, target)) return;
      toast.error("That connection would create a loop", {
        description: "A workflow runs each node once, so a connection cannot lead back to an earlier node.",
      });
    },
    [edgesRef],
  );

  return { isValidConnection, onConnectEnd };
}
