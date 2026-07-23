import { useEffect, useCallback, useRef } from "react";
import type { Node } from "reactflow";
import { toast } from "sonner";
import useCanvasStore from "../stores/CanvasStore";
import { getCanvasClipboardShortcutAction } from "../utils/shortcutGuards";
import type { CanvasActionType } from "../types/CanvasActionType";
import type { WorkflowCanvasNodeData } from "../types/WorkflowCanvasNodeData";

interface UseClipboardActionsParams {
  nodes: Node<WorkflowCanvasNodeData>[];
  setNodes: React.Dispatch<
    React.SetStateAction<Node<WorkflowCanvasNodeData>[]>
  >;
  isEditorOverlayOpen: boolean;
}

export function useClipboardActions({
  nodes,
  setNodes,
  isEditorOverlayOpen,
}: UseClipboardActionsParams) {
  const selectedNodeRef = useRef<Node<WorkflowCanvasNodeData> | null>(null);
  const newDuplicateNodeRef = useRef<string | null>(null);

  const handlePendingAction = useCallback(
    (action: {
      type: CanvasActionType;
      nodeId?: string;
      timestamp: number;
    }) => {
      const { type, nodeId } = action;

      if (type === "duplicate" && nodeId) {
        const nodeToClone = nodes.find((n) => n.id === nodeId);
        if (nodeToClone) {
          const newNode: Node<WorkflowCanvasNodeData> = {
            ...nodeToClone,
            id: `${nodeToClone.id}-${action.timestamp}`,
            position: {
              x: nodeToClone.position.x + 150,
              y: nodeToClone.position.y + 150,
            },
            data: {
              ...nodeToClone.data,
              config: nodeToClone.data.config
                ? JSON.parse(JSON.stringify(nodeToClone.data.config))
                : {},
            },
          };
          setNodes((nds) => [...nds, newNode]);
        }
      } else if (type === "copy" && nodeId) {
        const nodeToClone = nodes.find((n) => n.id === nodeId);
        if (nodeToClone && nodeToClone.type) {
          useCanvasStore.getState().setClipboardNode({
            type: nodeToClone.type,
            data: JSON.parse(JSON.stringify(nodeToClone.data)),
          });
        }
      } else if (type === "paste") {
        useCanvasStore.getState().hydrateClipboard();
        const cloneData = useCanvasStore.getState().clipboardNode;
        if (!cloneData) {
          toast.error("No node in clipboard");
        } else {
          try {
            const { type: nodeType, data } = cloneData;
            let newPosition = { x: 400, y: 300 };
            if (selectedNodeRef.current) {
              newPosition = {
                x: selectedNodeRef.current.position.x + 200,
                y: selectedNodeRef.current.position.y + 150,
              };
            } else if (nodes.length > 0) {
              const lastNode = nodes[nodes.length - 1]!;
              newPosition = {
                x: lastNode.position.x + 150,
                y: lastNode.position.y + 150,
              };
            }
            setNodes((nds) => [
              ...nds,
              {
                id: `node-${action.timestamp}`,
                type: nodeType,
                position: newPosition,
                data,
              },
            ]);
            toast.success("Node pasted successfully");
          } catch (err) {
            const errorMessage =
              err instanceof Error ? err.message : "Unknown error";
            toast.error("Error pasting node: " + errorMessage);
          }
        }
      }
      useCanvasStore.getState().clearPendingAction();
    },
    [nodes, setNodes],
  );

  useEffect(() => {
    return useCanvasStore
      .getState()
      .registerPendingActionHandler(handlePendingAction);
  }, [handlePendingAction]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const action = getCanvasClipboardShortcutAction({
        event: e,
        hasSelectedNode: !!selectedNodeRef.current,
        isEditorOverlayOpen,
      });
      if (!action) return;

      if (action === "copy" && selectedNodeRef.current) {
        e.preventDefault();
        useCanvasStore.getState().copyNode(selectedNodeRef.current.id);
        toast.success("Node copied to clipboard");
      }

      if (action === "paste") {
        e.preventDefault();
        useCanvasStore.getState().pasteNode();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isEditorOverlayOpen]);

  return { selectedNodeRef, newDuplicateNodeRef };
}
