import { useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import useCanvasStore from "../stores/CanvasStore";
import { getCanvasClipboardShortcutAction } from "../utils/shortcutGuards";
import { copyNodes, pasteNodes } from "../utils/canvasClipboard";
import { selectedIds, sortFramesFirst } from "../utils/canvasGroups";
import type { CanvasActionType } from "../types/CanvasActionType";
import type { CanvasClipboard } from "../types/CanvasClipboard";
import type { CanvasEdge } from "../types/CanvasEdge";
import type { CanvasNode } from "../types/CanvasNode";

interface UseClipboardActionsParams {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  setNodes: React.Dispatch<React.SetStateAction<CanvasNode[]>>;
  setEdges: React.Dispatch<React.SetStateAction<CanvasEdge[]>>;
  isEditorOverlayOpen: boolean;
}

/**
 * Copy, paste and duplicate act on the selection: every selected node, the
 * children of a selected frame, and the edges between them. A node's own menu
 * acts on the selection when that node is part of it, and on the node alone
 * otherwise.
 */
export function useClipboardActions({
  nodes,
  edges,
  setNodes,
  setEdges,
  isEditorOverlayOpen,
}: UseClipboardActionsParams) {
  const selectedNodeRef = useRef<CanvasNode | null>(null);
  const newDuplicateNodeRef = useRef<string | null>(null);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const insert = useCallback(
    (clipboard: CanvasClipboard, stamp: number) => {
      const pasted = pasteNodes(clipboard, stamp);
      setNodes((current) =>
        sortFramesFirst([
          ...current.map((node) =>
            node.selected ? { ...node, selected: false } : node,
          ),
          ...pasted.nodes,
        ]),
      );
      setEdges((current) => [...current, ...pasted.edges]);
    },
    [setNodes, setEdges],
  );

  const handlePendingAction = useCallback(
    (action: { type: CanvasActionType; nodeId?: string; timestamp: number }) => {
      const { type, nodeId } = action;
      const targetIds = (): Set<string> => {
        const selection = selectedIds(nodes);
        return nodeId === undefined || selection.has(nodeId)
          ? selection
          : new Set([nodeId]);
      };

      if (type === "duplicate") {
        insert(copyNodes(nodes, edges, targetIds()), action.timestamp);
      } else if (type === "copy") {
        const clipboard = copyNodes(nodes, edges, targetIds());
        if (clipboard.nodes.length > 0) {
          useCanvasStore.getState().setClipboard(clipboard);
          toast.success(
            clipboard.nodes.length === 1
              ? "Node copied"
              : `${clipboard.nodes.length} nodes copied`,
          );
        }
      } else if (type === "paste") {
        useCanvasStore.getState().hydrateClipboard();
        const clipboard = useCanvasStore.getState().clipboard;
        if (!clipboard || clipboard.nodes.length === 0) {
          toast.error("Nothing to paste");
        } else {
          insert(clipboard, action.timestamp);
        }
      }
      useCanvasStore.getState().clearPendingAction();
    },
    [nodes, edges, insert],
  );

  useEffect(() => {
    return useCanvasStore
      .getState()
      .registerPendingActionHandler(handlePendingAction);
  }, [handlePendingAction]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const selected = nodesRef.current.find((node) => node.selected);
      const action = getCanvasClipboardShortcutAction({
        event: e,
        hasSelectedNode: selected !== undefined,
        isEditorOverlayOpen,
      });
      if (!action) return;
      e.preventDefault();
      const store = useCanvasStore.getState();
      if (action === "paste") store.pasteNode();
      else if (selected && action === "copy") store.copyNode(selected.id);
      else if (selected) store.duplicateNode(selected.id);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isEditorOverlayOpen]);

  return { selectedNodeRef, newDuplicateNodeRef };
}
