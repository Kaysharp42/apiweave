import { useCallback } from "react";
import { useReactFlow } from "@xyflow/react";
import type { CanvasNode } from "../types/CanvasNode";

/**
 * Patch one key of a canvas node's config through ReactFlow's `updateNodeData`.
 *
 * The three editable canvas nodes each carried their own `useCallback` wrapping
 * the same `patchNodeData(id, ...)` call; that shared shape is what this owns,
 * so the nodes stay a description of their UI rather than of the store update.
 */
export function useNodeConfigPatch(
  id: string,
): (key: string, value: unknown) => void {
  const { updateNodeData: patchNodeData } = useReactFlow<CanvasNode>();
  return useCallback(
    (key: string, value: unknown) => {
      patchNodeData(id, (node) => ({
        config: { ...node.data.config, [key]: value },
      }));
    },
    [id, patchNodeData],
  );
}
