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
// The dataId alone drives "did the node's editable content change?" — position is
// tracked separately in the signature, so a drag fires the debounced save.
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
      const node = n as {
        id?: string;
        data?: object;
        position?: { x?: number; y?: number };
      };
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
      // ponytail: include position so drag/auto-layout fires the debounced save.
      // The 700ms debounce absorbs per-frame churn during continuous drag.
      parts.push(
        `${node.id ?? "?"}:${dataId}:${node.position?.x ?? 0},${node.position?.y ?? 0}`,
      );
    }
    return parts.join("|");
  }, [nodes]);

  const edgesSig = useMemo(() => {
    const parts: string[] = [];
    for (const e of edges) {
      const edge = e as {
        id?: string;
        source?: string;
        target?: string;
        label?: unknown;
        animated?: boolean;
      };
      // ponytail: include label + animated so edge edits (assertion pass/fail text,
      // branch label) re-fire the debounced save.
      parts.push(
        `${edge.id ?? "?"}:${edge.source ?? "?"}:${edge.target ?? "?"}:${typeof edge.label === "string" ? edge.label : ""}:${edge.animated ? 1 : 0}`,
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
