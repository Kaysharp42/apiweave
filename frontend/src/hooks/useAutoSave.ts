import { useEffect, useRef } from 'react';
import useTabStore from '../stores/TabStore';

interface UseAutoSaveParams {
  workflowId: string | undefined;
  autoSaveEnabled: boolean;
  isHydrated?: boolean;
  nodes: unknown[];
  edges: unknown[];
  workflowVariables: Record<string, unknown>;
  saveWorkflow: (silent: boolean) => void;
}

interface Snapshot {
  nodes: unknown[] | null;
  edges: unknown[] | null;
  vars: Record<string, unknown> | null;
}

export default function useAutoSave({
  workflowId,
  autoSaveEnabled,
  isHydrated = true,
  nodes,
  edges,
  workflowVariables,
  saveWorkflow,
}: UseAutoSaveParams): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSnapshotRef = useRef<Snapshot>({ nodes: null, edges: null, vars: null });

  useEffect(() => {
    if (!autoSaveEnabled || !workflowId || !isHydrated) return;

    const lastSnapshot = lastSnapshotRef.current;

    if (lastSnapshot.nodes === null && lastSnapshot.edges === null && lastSnapshot.vars === null) {
      lastSnapshotRef.current = { nodes, edges, vars: workflowVariables };
      return;
    }

    if (lastSnapshot.nodes === nodes && lastSnapshot.edges === edges && lastSnapshot.vars === workflowVariables) {
      return;
    }

    lastSnapshotRef.current = { nodes, edges, vars: workflowVariables };

    if (timerRef.current) clearTimeout(timerRef.current);

    useTabStore.getState().markDirty(workflowId);

    timerRef.current = setTimeout(() => {
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
