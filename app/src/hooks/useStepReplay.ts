import { useCallback } from "react";
import { toast } from "sonner";
import type { BrowserLocator } from "@shared/types/BrowserLocator";
import type { BrowserReplayRequest } from "@shared/types/BrowserReplayRequest";
import { useBrowserRecordingStore } from "../stores/BrowserRecordingStore";
import type { CanvasNode } from "../types/CanvasNode";
import type { UseStepReplayParams } from "../types/UseStepReplayParams";
import type { UseStepReplayResult } from "../types/UseStepReplayResult";
import { canRepick, canRerecordFrom } from "../utils/stepReplay";

const rerecordLabel = (): string =>
  `Re-recorded ${new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`;

/** The node with `locator` in place of its own; everything else about the step stays. */
function withLocator(node: CanvasNode, locator: BrowserLocator): CanvasNode {
  // A new `data` object: auto-save tells edits apart by its identity.
  return { ...node, data: { ...node.data, config: { ...node.data.config, locator } } };
}

/**
 * **Re-pick element** and **Re-record from here** on a browser step. Both
 * save pending edits, then main replays the workflow up to the step in a
 * browser on the user's screen. A re-pick then puts the element the user
 * picks on that step and changes nothing else; a re-record's steps are placed
 * by `useBrowserRecording`, in place of the ones they replace.
 */
export function useStepReplay(params: UseStepReplayParams): UseStepReplayResult {
  const { workflowId, workspaceId, environmentId, isHydrated, isRunning, nodesRef, edgesRef, setNodes, saveWorkflowRef } = params;
  const idle = useBrowserRecordingStore((state) => state.phase === "idle");
  const ready = idle && isHydrated && !isRunning && workflowId !== undefined && workspaceId !== undefined;

  const graph = useCallback(() => ({ nodes: nodesRef.current, edges: edgesRef.current }), [edgesRef, nodesRef]);

  /** The request for `nodeId`, once pending edits are saved; null when they could not be. */
  const prepare = useCallback(
    async (nodeId: string): Promise<BrowserReplayRequest | null> => {
      if (workflowId === undefined || workspaceId === undefined) return null;
      if (saveWorkflowRef.current !== null && !(await saveWorkflowRef.current(false))) return null;
      return { workspaceId, workflowId, environmentId, nodeId };
    },
    [environmentId, saveWorkflowRef, workflowId, workspaceId],
  );

  const repick = useCallback(
    (nodeId: string) => {
      void (async () => {
        const request = await prepare(nodeId);
        if (request === null) return;
        const locator = await useBrowserRecordingStore.getState().repick(request);
        if (locator === null) return;
        if (!nodesRef.current.some((node) => node.id === nodeId)) {
          toast.warning("The step was deleted while you picked, so the element was not saved.");
          return;
        }
        // A save reads the ref: set it first, so Ctrl+S right after keeps the change.
        nodesRef.current = nodesRef.current.map((node) => (node.id === nodeId ? withLocator(node, locator) : node));
        setNodes(nodesRef.current);
        toast.success("The step now uses the element you picked");
      })();
    },
    [nodesRef, prepare, setNodes],
  );

  const rerecord = useCallback(
    (nodeId: string) => {
      void (async () => {
        const request = await prepare(nodeId);
        if (request !== null) await useBrowserRecordingStore.getState().rerecord(request, rerecordLabel());
      })();
    },
    [prepare],
  );

  return {
    canRepick: (nodeId) => ready && canRepick(graph(), nodeId),
    canRerecord: (nodeId) => ready && canRerecordFrom(graph(), nodeId),
    repick,
    rerecord,
  };
}
