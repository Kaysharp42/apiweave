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
  nodes,
  edges,
  workflowVariables,
  saveWorkflow,
}) {
  const timerRef = useRef(null);

  useEffect(() => {
    if (!autoSaveEnabled || !workflowId) return;

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
  }, [nodes, edges, workflowVariables, autoSaveEnabled, workflowId, saveWorkflow]);
}
