import { create } from 'zustand';
import type { CanvasActionType } from '../types/CanvasActionType';
import type { ClipboardNodeData } from '../types/ClipboardNodeData';

interface CanvasState {
  pendingAction: { type: CanvasActionType; nodeId?: string; timestamp: number } | null;
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
}

const useCanvasStore = create<CanvasState>()((set) => ({
  pendingAction: null,
  clipboardNode: null,
  reloadWorkflowId: null,
  reloadVersion: 0,

  duplicateNode: (nodeId: string) =>
    set({ pendingAction: { type: 'duplicate' as CanvasActionType, nodeId, timestamp: Date.now() } }),

  copyNode: (nodeId: string) =>
    set({ pendingAction: { type: 'copy' as CanvasActionType, nodeId, timestamp: Date.now() } }),

  pasteNode: () =>
    set({ pendingAction: { type: 'paste' as CanvasActionType, timestamp: Date.now() } }),

  clearPendingAction: () => set({ pendingAction: null }),

  setClipboardNode: (nodeData: ClipboardNodeData | null) => {
    if (nodeData) {
      sessionStorage.setItem('copiedNode:v1', JSON.stringify(nodeData));
    }
    set({ clipboardNode: nodeData });
  },

  hydrateClipboard: () => {
    try {
      const raw = sessionStorage.getItem('copiedNode:v1');
      if (raw) set({ clipboardNode: JSON.parse(raw) as ClipboardNodeData });
    } catch { /* ignore */ }
  },

  signalWorkflowReload: (workflowId: string) =>
    set((s) => ({ reloadWorkflowId: workflowId, reloadVersion: s.reloadVersion + 1 })),
}));

export default useCanvasStore;
