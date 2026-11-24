import type { CanvasActionType } from "./CanvasActionType";
import type { CanvasClipboard } from "./CanvasClipboard";
import type { NodeMenuRequest } from "./NodeMenuRequest";

export interface CanvasState {
  pendingAction: {
    type: CanvasActionType;
    nodeId?: string;
    timestamp: number;
  } | null;
  clipboard: CanvasClipboard | null;
  reloadWorkflowId: string | null;
  reloadVersion: number;
  /**
   * A Call Workflow node asking for the callee's History, opened on the run
   * that call produced. Held as state rather than fired as an event because
   * the target canvas usually isn't mounted yet when the jump starts — it
   * reads this on mount and clears it.
   */
  pendingHistory: { workflowId: string; runId: string } | null;
  /** A search result asking its workflow's canvas to select and frame a node; read on mount like `pendingHistory`. */
  pendingFocus: { workflowId: string; nodeId: string } | null;
  /** The node action menu currently open, or null. One at a time. */
  nodeMenu: NodeMenuRequest | null;
  openNodeMenu: (request: NodeMenuRequest) => void;
  closeNodeMenu: () => void;
  /** Ids of canvas nodes currently expanded. UI-only, never saved with the workflow. */
  expandedNodeIds: ReadonlySet<string>;
  setNodeExpanded: (nodeId: string, expanded: boolean) => void;
  /** Close the node menu and collapse every node — called when a canvas unmounts. */
  resetCanvasNodeUi: () => void;
  duplicateNode: (nodeId: string) => void;
  copyNode: (nodeId: string) => void;
  pasteNode: () => void;
  savePresetFromNode: (nodeId: string) => void;
  /** Rerun the workflow from this node on, reusing the latest run's results upstream. */
  runFromNode: (nodeId: string) => void;
  clearPendingAction: () => void;
  setClipboard: (clipboard: CanvasClipboard) => void;
  hydrateClipboard: () => void;
  openWorkflowHistory: (workflowId: string, runId: string) => void;
  clearPendingHistory: () => void;
  focusNode: (workflowId: string, nodeId: string) => void;
  clearPendingFocus: () => void;
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
