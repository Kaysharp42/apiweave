import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import type { BrowserLocator } from "@shared/types/BrowserLocator";
import type { BrowserReplayRequest } from "@shared/types/BrowserReplayRequest";
import { useBrowserRecordingStore } from "../stores/BrowserRecordingStore";
import type { CanvasNode } from "../types/CanvasNode";
import type { UseStepReplayParams } from "../types/UseStepReplayParams";
import type { UseStepReplayResult } from "../types/UseStepReplayResult";
import { canRecordAfter, canRepick, canRerecordFrom } from "../utils/stepReplay";

const stamp = (): string => new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const rerecordLabel = (): string => `Re-recorded ${stamp()}`;
const recordAfterLabel = (): string => `Recording ${stamp()}`;

/** The node with `locator` in place of its own; everything else about the step stays. */
function withLocator(node: CanvasNode, locator: BrowserLocator): CanvasNode {
  // A new `data` object: auto-save tells edits apart by its identity.
  return { ...node, data: { ...node.data, config: { ...node.data.config, locator } } };
}

/**
 * **Re-pick element**, **Re-record from here** and **Record after this step**
 * on a step. Each saves pending edits, then main replays the workflow up to
 * the step — through it, for a record-after — in a browser on the user's
 * screen. A re-pick then puts the element the user picks on that step and
 * changes nothing else; recorded steps are placed by `useBrowserRecording`,
 * in place of the ones a re-record replaces, or after a record-after's step.
 */
export function useStepReplay(params: UseStepReplayParams): UseStepReplayResult {
  const { workflowId, workspaceId, environmentId, isHydrated, isRunning, nodesRef, edgesRef, setNodes, saveWorkflowRef } = params;
  const idle = useBrowserRecordingStore((state) => state.phase === "idle");
  const picked = useBrowserRecordingStore((state) => state.picked);
  const ready = idle && isHydrated && !isRunning && workflowId !== undefined && workspaceId !== undefined;

  const graph = useCallback(() => ({ nodes: nodesRef.current, edges: edgesRef.current }), [edgesRef, nodesRef]);

  /**
   * Put a re-pick's element on its step. The store holds it until a canvas
   * applies it, so the canvas that was open while the user picked can be gone:
   * this one, or the one opened later, still gets the change. Taken from the
   * store rather than the render so that React's double effect applies it once.
   */
  useEffect(() => {
    if (!isHydrated || workflowId === undefined) return;
    const store = useBrowserRecordingStore.getState();
    const pending = store.picked;
    if (pending === null || pending.workflowId !== workflowId) return;
    store.takePicked();
    const { nodeId, locator } = pending;
    const node = nodesRef.current.find((candidate) => candidate.id === nodeId);
    if (node === undefined) {
      toast.warning("The step was deleted while you picked, so the element was not saved.");
      return;
    }
    // The step's action can change while the pick is open: put the element only on a step that still acts on one.
    if (node.data.config?.["locator"] === undefined) {
      toast.warning("The step no longer acts on an element, so the element you picked was not saved.");
      return;
    }
    // A save reads the ref: set it first, so Ctrl+S right after keeps the change.
    nodesRef.current = nodesRef.current.map((node) => (node.id === nodeId ? withLocator(node, locator) : node));
    setNodes(nodesRef.current);
    toast.success("The step now uses the element you picked");
  }, [isHydrated, nodesRef, picked, setNodes, workflowId]);

  /** The request for `nodeId`, once pending edits are saved; null when they could not be. */
  const prepare = useCallback(
    async (nodeId: string): Promise<BrowserReplayRequest | null> => {
      if (workflowId === undefined || workspaceId === undefined) return null;
      if (saveWorkflowRef.current !== null && !(await saveWorkflowRef.current(false))) return null;
      return { workspaceId, workflowId, environmentId, nodeId };
    },
    [environmentId, saveWorkflowRef, workflowId, workspaceId],
  );

  /** Save pending edits, then hand the request for `nodeId` to `run`; nothing replays when the save is refused. */
  const replay = useCallback(
    async (nodeId: string, run: (request: BrowserReplayRequest) => Promise<void>): Promise<void> => {
      const request = await prepare(nodeId);
      if (request !== null) await run(request);
    },
    [prepare],
  );

  const repick = useCallback(
    (nodeId: string) => {
      // The element arrives as a `picked` event, and the effect above applies it.
      void replay(nodeId, (request) => useBrowserRecordingStore.getState().repick(request));
    },
    [replay],
  );

  const rerecord = useCallback(
    (nodeId: string) => {
      void replay(nodeId, (request) => useBrowserRecordingStore.getState().rerecord(request, rerecordLabel()));
    },
    [replay],
  );

  const recordAfter = useCallback(
    (nodeId: string) => {
      void replay(nodeId, (request) => useBrowserRecordingStore.getState().recordAfter(request, recordAfterLabel()));
    },
    [replay],
  );

  return {
    canRepick: (nodeId) => ready && canRepick(graph(), nodeId),
    canRerecord: (nodeId) => ready && canRerecordFrom(graph(), nodeId),
    canRecordAfter: (nodeId) => ready && canRecordAfter(graph(), nodeId),
    repick,
    rerecord,
    recordAfter,
  };
}
