import { useCallback, useEffect, useMemo, useRef } from "react";
import useTabStore from "../stores/TabStore";

interface UseAutoSaveParams {
  workflowId: string | undefined;
  autoSaveEnabled: boolean;
  isHydrated?: boolean;
  /** Changes when a server snapshot replaces the live canvas. */
  resetSnapshotKey?: number;
  nodes: unknown[];
  edges: unknown[];
  workflowVariables: Record<string, unknown>;
  saveWorkflow: (silent: boolean) => Promise<unknown>;
}

interface Snapshot {
  nodes: string | null;
  edges: string | null;
  vars: Record<string, unknown> | null;
}

// Stable numeric id per node `config` object, by reference. Config edits
// always replace the object, so its id answers "did the stored config change?"
// without walking it on every drag frame.
const configIdMap = new WeakMap<object, number>();
let nextConfigId = 0;

function configId(config: object | undefined): number {
  if (!config) return -1;
  const existing = configIdMap.get(config);
  if (existing !== undefined) return existing;
  const id = nextConfigId++;
  configIdMap.set(config, id);
  return id;
}

export default function useAutoSave({
  workflowId,
  autoSaveEnabled,
  isHydrated = true,
  resetSnapshotKey = 0,
  nodes,
  edges,
  workflowVariables,
  saveWorkflow,
}: UseAutoSaveParams): () => Promise<void> {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // What the scheduled save will write, so a flush can advance the baseline.
  const pendingSnapshotRef = useRef<Snapshot | null>(null);
  const inFlightRef = useRef<Promise<void>>(Promise.resolve());
  // Latest closure: a flush on unmount must save the latest canvas, not the
  // one captured when the timer was scheduled.
  const saveRef = useRef(saveWorkflow);
  saveRef.current = saveWorkflow;
  const lastSnapshotRef = useRef<Snapshot>({
    nodes: null,
    edges: null,
    vars: null,
  });

  // Signatures cover exactly what a save writes (`canvasToWorkflow`), and
  // nothing the canvas derives for display — branch counts, run status, edge
  // appearance. A derived write after a snapshot lands would otherwise read as
  // an edit and save, moving `rev` under every agent that read it.
  const nodesSig = useMemo(() => {
    const parts: string[] = [];
    for (const n of nodes) {
      const node = n as {
        id?: string;
        type?: string;
        parentId?: string;
        // Explicit attributes only: React Flow writes them on a resize, and
        // keeps its own measurements in `measured`.
        width?: number;
        height?: number;
        data?: { label?: unknown; config?: object };
        position?: { x?: number; y?: number };
      };
      parts.push(
        JSON.stringify([
          node.id ?? "?",
          node.type ?? "",
          node.parentId ?? "",
          typeof node.data?.label === "string" ? node.data.label : null,
          configId(node.data?.config),
          node.position?.x ?? 0,
          node.position?.y ?? 0,
          node.width ?? null,
          node.height ?? null,
        ]),
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
        sourceHandle?: string | null;
        targetHandle?: string | null;
        label?: unknown;
        data?: { label?: unknown };
      };
      parts.push(
        JSON.stringify([
          edge.id ?? "?",
          edge.source ?? "?",
          edge.target ?? "?",
          edge.sourceHandle ?? null,
          edge.targetHandle ?? null,
          typeof edge.label === "string" ? edge.label : null,
          typeof edge.data?.label === "string" ? edge.data.label : null,
        ]),
      );
    }
    return parts.join("|");
  }, [edges]);

  const currentSnapshotRef = useRef<Snapshot>({
    nodes: nodesSig,
    edges: edgesSig,
    vars: workflowVariables,
  });
  currentSnapshotRef.current = {
    nodes: nodesSig,
    edges: edgesSig,
    vars: workflowVariables,
  };

  useEffect(() => {
    // The reset is for live snapshots that replace the canvas (e.g. MCP writes).
    // On the very first mount lastSnapshot is null and will be initialized by
    // the autosave effect once hydration completes — overwriting null with the
    // pre-hydration empty snapshot would make the first real hydration look
    // like a dirty edit and fire an immediate autosave.
    if (
      lastSnapshotRef.current.nodes === null &&
      lastSnapshotRef.current.edges === null &&
      lastSnapshotRef.current.vars === null
    ) {
      return;
    }
    lastSnapshotRef.current = currentSnapshotRef.current;
  }, [resetSnapshotKey]);

  /**
   * Sends the debounced save now instead of when its timer fires, and resolves
   * once the latest auto-save (this one or one already in flight) settles. A
   * no-op when nothing is pending, so it never adds a save of its own.
   */
  const flush = useCallback((): Promise<void> => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      if (pendingSnapshotRef.current) {
        lastSnapshotRef.current = pendingSnapshotRef.current;
      }
      inFlightRef.current = saveRef.current(true).then(() => undefined);
    }
    return inFlightRef.current;
  }, []);

  useEffect(() => {
    // A dependency changed: drop the scheduled save without sending it. It is
    // rescheduled below if the canvas is still ahead of the last save; if
    // auto-save was just disabled (e.g. a run started) it stays dropped, and
    // the snapshot stays at the last-saved state so re-enabling reschedules
    // it instead of short-circuiting on the equality check.
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

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

    useTabStore.getState().markDirty(workflowId);

    pendingSnapshotRef.current = {
      nodes: nodesSig,
      edges: edgesSig,
      vars: workflowVariables,
    };
    timerRef.current = setTimeout(() => void flush(), 700);
  }, [
    nodesSig,
    edgesSig,
    workflowVariables,
    autoSaveEnabled,
    workflowId,
    isHydrated,
    flush,
  ]);

  // Unmount (tab switch, tab close, workspace switch) sends a pending save
  // rather than dropping it — the canvas state it would have written is gone
  // with the component.
  useEffect(() => () => void flush(), [flush]);

  return flush;
}
