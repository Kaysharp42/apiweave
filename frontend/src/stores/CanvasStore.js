import { create } from 'zustand';

/**
 * CanvasStore — Zustand store for cross-component canvas operations.
 *
 * Replaces `window.dispatchEvent(new CustomEvent('duplicateNode', ...))`
 * and similar clipboard/node-action events that were broadcast globally
 * and listened to inside WorkflowCanvas.
 *
 * BaseNode menu buttons call store actions directly; WorkflowCanvas
 * subscribes to the pending action via the hook and processes it.
 *
 * Also replaces the `workflowUpdated` event (e.g., from CurlImport).
 */
const useCanvasStore = create((set) => ({
  // --- Pending node action (duplicate / copy / paste) ---
  // { type: 'duplicate' | 'copy' | 'paste', nodeId?: string, timestamp: number }
  pendingAction: null,

  // --- Clipboard (persisted in sessionStorage for cross-tab copy) ---
  clipboardNode: null,

  // --- Workflow reload signal ---
  // Incremented when an external mutation (e.g., CurlImport) updates a workflow
  // and the canvas for that workflowId needs to reload from the server.
  reloadWorkflowId: null,
  reloadVersion: 0,

  // --- Actions ---

  /** Request a node duplicate. WorkflowCanvas processes this. */
  duplicateNode: (nodeId) =>
    set({ pendingAction: { type: 'duplicate', nodeId, timestamp: Date.now() } }),

  /** Request a node copy to clipboard. */
  copyNode: (nodeId) =>
    set({ pendingAction: { type: 'copy', nodeId, timestamp: Date.now() } }),

  /** Request a paste from clipboard. */
  pasteNode: () =>
    set({ pendingAction: { type: 'paste', timestamp: Date.now() } }),

  /** Clear the pending action (after WorkflowCanvas has processed it). */
  clearPendingAction: () => set({ pendingAction: null }),

  /** Store a node in the clipboard (also persists to sessionStorage). */
  setClipboardNode: (nodeData) => {
    if (nodeData) {
      sessionStorage.setItem('copiedNode', JSON.stringify(nodeData));
    }
    set({ clipboardNode: nodeData });
  },

  /** Read clipboard from sessionStorage (hydrate on mount). */
  hydrateClipboard: () => {
    try {
      const raw = sessionStorage.getItem('copiedNode');
      if (raw) set({ clipboardNode: JSON.parse(raw) });
    } catch { /* ignore */ }
  },

  /**
   * Signal that a workflow was externally mutated and its canvas
   * should reload from the server.
   */
  signalWorkflowReload: (workflowId) =>
    set((s) => ({ reloadWorkflowId: workflowId, reloadVersion: s.reloadVersion + 1 })),
}));

export default useCanvasStore;
