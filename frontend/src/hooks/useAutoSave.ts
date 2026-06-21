import { useEffect, useMemo, useRef } from "react";
import useTabStore from "../stores/TabStore";

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
  nodes: string | null;
  edges: string | null;
  vars: Record<string, unknown> | null;
}

// Module-level WeakMap assigns a stable numeric ID to each data object by reference.
// ReactFlow preserves data refs during position-only changes (pan/drag), so the
// signature only shifts when a node's data is actually replaced — not every frame.
const dataIdMap = new WeakMap<object, number>();
let nextDataId = 0;

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
  const lastSnapshotRef = useRef<Snapshot>({
    nodes: null,
    edges: null,
    vars: null,
  });

  const nodesSig = useMemo(() => {
    const parts: string[] = [];
    for (const n of nodes) {
      const node = n as { id?: string; data?: object };
      let dataId: number;
      if (node.data) {
        const existing = dataIdMap.get(node.data);
        if (existing !== undefined) {
          dataId = existing;
        } else {
          dataId = nextDataId++;
          dataIdMap.set(node.data, dataId);
        }
      } else {
        dataId = -1;
      }
      parts.push(`${node.id ?? "?"}:${dataId}`);
    }
    return parts.join("|");
  }, [nodes]);

  const edgesSig = useMemo(() => {
    const parts: string[] = [];
    for (const e of edges) {
      const edge = e as { id?: string; source?: string; target?: string };
      parts.push(
        `${edge.id ?? "?"}:${edge.source ?? "?"}:${edge.target ?? "?"}`,
      );
    }
    return parts.join("|");
  }, [edges]);

  useEffect(() => {
    if (!autoSaveEnabled || !workflowId || !isHydrated) return;

    const lastSnapshot = lastSnapshotRef.current;

    if (
      lastSnapshot.nodes === null &&
      lastSnapshot.edges === null &&
      lastSnapshot.vars === null
    ) {
      lastSnapshotRef.current = {
        nodes: nodesSig,
        edges: edgesSig,
        vars: workflowVariables,
      };
      return;
    }

    if (
      lastSnapshot.nodes === nodesSig &&
      lastSnapshot.edges === edgesSig &&
      lastSnapshot.vars === workflowVariables
    ) {
      return;
    }

    lastSnapshotRef.current = {
      nodes: nodesSig,
      edges: edgesSig,
      vars: workflowVariables,
    };

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
  }, [
    nodesSig,
    edgesSig,
    workflowVariables,
    autoSaveEnabled,
    workflowId,
    isHydrated,
    saveWorkflow,
  ]);
}
