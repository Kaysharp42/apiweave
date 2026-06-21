import { create } from "zustand";
import type { CanvasActionType } from "../types/CanvasActionType";
import type { ClipboardNodeData } from "../types/ClipboardNodeData";

interface CanvasState {
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

const workflowReloadHandlers = new Map<string, Set<() => void>>();
const pendingActionHandlers = new Set<
  (action: {
    type: CanvasActionType;
    nodeId?: string;
    timestamp: number;
  }) => void
>();

function notifyPendingActionHandlers(action: {
  type: CanvasActionType;
  nodeId?: string;
  timestamp: number;
}): void {
  pendingActionHandlers.forEach((handler) => handler(action));
}

const useCanvasStore = create<CanvasState>()((set) => ({
  pendingAction: null,
  clipboardNode: null,
  reloadWorkflowId: null,
  reloadVersion: 0,

  duplicateNode: (nodeId: string) => {
    const action = {
      type: "duplicate" as CanvasActionType,
      nodeId,
      timestamp: Date.now(),
    };
    set({ pendingAction: action });
    notifyPendingActionHandlers(action);
  },

  copyNode: (nodeId: string) => {
    const action = {
      type: "copy" as CanvasActionType,
      nodeId,
      timestamp: Date.now(),
    };
    set({ pendingAction: action });
    notifyPendingActionHandlers(action);
  },

  pasteNode: () => {
    const action = { type: "paste" as CanvasActionType, timestamp: Date.now() };
    set({ pendingAction: action });
    notifyPendingActionHandlers(action);
  },

  clearPendingAction: () => set({ pendingAction: null }),

  setClipboardNode: (nodeData: ClipboardNodeData | null) => {
    if (nodeData) {
      sessionStorage.setItem("copiedNode:v1", JSON.stringify(nodeData));
    }
    set({ clipboardNode: nodeData });
  },

  hydrateClipboard: () => {
    try {
      const raw = sessionStorage.getItem("copiedNode:v1");
      if (raw) set({ clipboardNode: JSON.parse(raw) as ClipboardNodeData });
    } catch {
      /* ignore */
    }
  },

  signalWorkflowReload: (workflowId: string) => {
    set((s) => ({
      reloadWorkflowId: workflowId,
      reloadVersion: s.reloadVersion + 1,
    }));
    workflowReloadHandlers.get(workflowId)?.forEach((handler) => handler());
  },

  registerWorkflowReloadHandler: (workflowId: string, handler: () => void) => {
    const handlers =
      workflowReloadHandlers.get(workflowId) ?? new Set<() => void>();
    handlers.add(handler);
    workflowReloadHandlers.set(workflowId, handlers);

    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) {
        workflowReloadHandlers.delete(workflowId);
      }
    };
  },

  registerPendingActionHandler: (handler) => {
    pendingActionHandlers.add(handler);
    return () => {
      pendingActionHandlers.delete(handler);
    };
  },
}));

export default useCanvasStore;
