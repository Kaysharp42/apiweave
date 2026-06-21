import type { CanvasActionType } from "./CanvasActionType";
import type { ClipboardNodeData } from "./ClipboardNodeData";

export interface CanvasState {
  pendingAction: {
    type: CanvasActionType;
    nodeId?: string;
    timestamp: number;
  } | null;
  clipboardNode: ClipboardNodeData | null;
  reloadWorkflowId: string | null;
  reloadVersion: number;
  duplicateNode: (nodeId: string) => void;
  copyNode: (nodeId: string) => void;
  pasteNode: () => void;
  clearPendingAction: () => void;
  setClipboardNode: (nodeData: ClipboardNodeData | null) => void;
  hydrateClipboard: () => void;
  signalWorkflowReload: (workflowId: string) => void;
  registerWorkflowReloadHandler: (
    workflowId: string,
    handler: () => void,
  ) => () => void;
  registerPendingActionHandler: (
    handler: (action: {
      type: CanvasActionType;
      nodeId?: string;
      timestamp: number;
    }) => void,
  ) => () => void;
}
