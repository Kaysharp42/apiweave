import { create } from "zustand";
import type { CanvasActionType } from "../types/CanvasActionType";
import type { CanvasClipboard } from "../types/CanvasClipboard";
import type { CanvasState } from "../types/CanvasState";

const CLIPBOARD_KEY = "canvasClipboard:v2";

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
  clipboard: null,
  reloadWorkflowId: null,
  reloadVersion: 0,
  pendingHistory: null,
  pendingFocus: null,

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

  savePresetFromNode: (nodeId: string) => {
    const action = {
      type: "save-preset" as CanvasActionType,
      nodeId,
      timestamp: Date.now(),
    };
    set({ pendingAction: action });
    notifyPendingActionHandlers(action);
  },

  runFromNode: (nodeId: string) => {
    const action = {
      type: "run-from" as CanvasActionType,
      nodeId,
      timestamp: Date.now(),
    };
    set({ pendingAction: action });
    notifyPendingActionHandlers(action);
  },

  clearPendingAction: () => set({ pendingAction: null }),

  // sessionStorage carries the clipboard across the tabs of this window.
  setClipboard: (clipboard: CanvasClipboard) => {
    try {
      sessionStorage.setItem(CLIPBOARD_KEY, JSON.stringify(clipboard));
    } catch {
      /* the in-memory copy still works */
    }
    set({ clipboard });
  },

  hydrateClipboard: () => {
    try {
      const raw = sessionStorage.getItem(CLIPBOARD_KEY);
      if (raw) set({ clipboard: JSON.parse(raw) as CanvasClipboard });
    } catch {
      /* ignore */
    }
  },

  openWorkflowHistory: (workflowId: string, runId: string) =>
    set({ pendingHistory: { workflowId, runId } }),

  clearPendingHistory: () => set({ pendingHistory: null }),

  focusNode: (workflowId: string, nodeId: string) =>
    set({ pendingFocus: { workflowId, nodeId } }),

  clearPendingFocus: () => set({ pendingFocus: null }),

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
