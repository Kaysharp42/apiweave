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
  /**
   * A Call Workflow node asking for the callee's History, opened on the run
   * that call produced. Held as state rather than fired as an event because
   * the target canvas usually isn't mounted yet when the jump starts — it
   * reads this on mount and clears it.
   */
  pendingHistory: { workflowId: string; runId: string } | null;
  duplicateNode: (nodeId: string) => void;
  copyNode: (nodeId: string) => void;
  pasteNode: () => void;
  savePresetFromNode: (nodeId: string) => void;
  clearPendingAction: () => void;
  setClipboardNode: (nodeData: ClipboardNodeData | null) => void;
  hydrateClipboard: () => void;
  openWorkflowHistory: (workflowId: string, runId: string) => void;
  clearPendingHistory: () => void;
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
