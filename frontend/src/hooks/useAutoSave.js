import { useEffect, useRef } from 'react';
import useTabStore from '../stores/TabStore';

/**
 * useAutoSave — debounced auto-save for workflow canvases.
 *
 * Extracted from WorkflowCanvas to reduce complexity.
 * Monitors `nodes`, `edges`, and `workflowVariables` for changes,
 * marks the tab dirty immediately, then fires a silent save after 700ms.
 *
 * @param {Object} params
 * @param {string}   params.workflowId
 * @param {boolean}  params.autoSaveEnabled  — global toggle from AppContext
 * @param {Array}    params.nodes
 * @param {Array}    params.edges
 * @param {Object}   params.workflowVariables
 * @param {Function} params.saveWorkflow      — the save callback (silent=true)
 */
export default function useAutoSave({
  workflowId,
  autoSaveEnabled,
  isHydrated = true,
  nodes,
  edges,
  workflowVariables,
  saveWorkflow,
}) {
  const timerRef = useRef(null);
  const lastSnapshotRef = useRef({ nodes: null, edges: null, vars: null });

  useEffect(() => {
    if (!autoSaveEnabled || !workflowId || !isHydrated) return;

    const lastSnapshot = lastSnapshotRef.current;

    // Seed baseline snapshot after initial hydration without marking dirty/saving.
    if (lastSnapshot.nodes === null && lastSnapshot.edges === null && lastSnapshot.vars === null) {
      lastSnapshotRef.current = { nodes, edges, vars: workflowVariables };
      return;
    }

    if (lastSnapshot.nodes === nodes && lastSnapshot.edges === edges && lastSnapshot.vars === workflowVariables) {
      return;
    }

    lastSnapshotRef.current = { nodes, edges, vars: workflowVariables };

    if (timerRef.current) clearTimeout(timerRef.current);

    // Mark tab dirty immediately so the UI shows an unsaved indicator
    useTabStore.getState().markDirty(workflowId);

    timerRef.current = setTimeout(() => {
      console.log('🔄 Auto-saving workflow...');
      saveWorkflow(true);
      timerRef.current = null;
    }, 700);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [nodes, edges, workflowVariables, autoSaveEnabled, workflowId, isHydrated, saveWorkflow]);
}
