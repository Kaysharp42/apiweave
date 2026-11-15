import { useCallback, useEffect, useMemo, useState } from "react";
import { subscribeToRecording, useBrowserRecordingStore } from "../stores/BrowserRecordingStore";
import useEnvironmentStore from "../stores/EnvironmentStore";
import type { CanvasNode } from "../types/CanvasNode";
import type { RecordingPlacement } from "../types/RecordingPlacement";
import type { UseBrowserRecordingParams } from "../types/UseBrowserRecordingParams";
import type { UseBrowserRecordingResult } from "../types/UseBrowserRecordingResult";
import { isFrameNode } from "../utils/canvasGroups";
import { resolveInheritedVariables } from "../utils/environmentInheritance";
import { placeRecordedStep } from "../utils/recordedSteps";

/** The selected node when exactly one is selected, else Start: where a recording's steps go after. */
function anchorFor(nodes: readonly CanvasNode[]): string | null {
  const selected = nodes.filter((node) => node.selected === true && !isFrameNode(node));
  if (selected.length === 1 && selected[0] !== undefined) return selected[0].id;
  return nodes.find((node) => node.type === "start")?.id ?? null;
}

/**
 * After a renderer reload the store has lost where the steps go. They follow
 * the last step this recording already put on the canvas (main names them
 * `browser-<stamp>-<n>` for a recording `recording-<stamp>`), else Start.
 */
function resumedAnchor(nodes: readonly CanvasNode[], recordingId: string): string | null {
  const prefix = `browser-${recordingId.replace(/^recording-/, "")}-`;
  const last = nodes
    .filter((node) => node.id.startsWith(prefix))
    .sort((a, b) => Number(a.id.slice(prefix.length)) - Number(b.id.slice(prefix.length)))
    .at(-1);
  return last?.id ?? anchorFor(nodes.map((node) => ({ ...node, selected: false })));
}

const recordingLabel = (): string =>
  `Recording ${new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`;

/**
 * Put the recording's steps on this canvas as they arrive, when it is the
 * workflow being recorded. Through `setNodes`/`setEdges` like any other edit,
 * so auto-save persists the steps and undo takes them back.
 */
function usePlaceRecordedSteps(
  isThisWorkflow: boolean,
  { isHydrated, nodesRef, edgesRef, setNodes, setEdges }: UseBrowserRecordingParams,
): void {
  const recordingId = useBrowserRecordingStore((state) => state.recordingId);
  const steps = useBrowserRecordingStore((state) => state.steps);

  useEffect(() => {
    if (!isHydrated || !isThisWorkflow || recordingId === null) return;
    const store = useBrowserRecordingStore.getState();
    // What an earlier mount already placed survives in the store, so a step that
    // has not changed since is left alone instead of overwriting the user's edits.
    const placedById = new Map(store.placedSteps.map((entry) => [entry.stepId, entry] as const));
    const pending = steps.filter((step) => placedById.get(step.stepId) !== step);
    if (pending.length === 0) return;
    const anchorId = store.anchorId ?? resumedAnchor(nodesRef.current, recordingId);
    const placement: RecordingPlacement = { anchorId: anchorId ?? "", frameId: `frame-${recordingId}`, frameLabel: store.frameLabel };
    let graph = { nodes: nodesRef.current, edges: edgesRef.current };
    const inserted = store.placedSteps.map((entry) => entry.stepId);
    const placed = [...store.placedSteps];
    for (const step of pending) {
      graph = placeRecordedStep(graph, step, placement, inserted);
      const at = inserted.indexOf(step.stepId);
      if (at === -1) {
        inserted.push(step.stepId);
        placed.push(step);
      } else {
        placed[at] = step;
      }
    }
    // A save reads the refs: set them first, so Ctrl+S right after a step keeps it.
    nodesRef.current = graph.nodes;
    edgesRef.current = graph.edges;
    setNodes(graph.nodes);
    setEdges(graph.edges);
    store.setPlaced(placed);
  }, [edgesRef, isHydrated, isThisWorkflow, nodesRef, recordingId, setEdges, setNodes, steps]);
}

/**
 * Recording a page into this workflow: the Record control's state, the start
 * dialog, and placing each step on the canvas as it arrives.
 */
export function useBrowserRecording(params: UseBrowserRecordingParams): UseBrowserRecordingResult {
  const { workflowId, workspaceId, environmentId, isHydrated, isRunning, nodesRef } = params;
  const phase = useBrowserRecordingStore((state) => state.phase);
  const recordingWorkflowId = useBrowserRecordingStore((state) => state.workflowId);
  const stepCount = useBrowserRecordingStore((state) => state.steps.length);
  const environments = useEnvironmentStore((state) => state.environments);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => subscribeToRecording(), []);

  const isThisWorkflow = workflowId !== undefined && recordingWorkflowId === workflowId;
  usePlaceRecordedSteps(isThisWorkflow, params);

  const defaultUrl = useMemo(() => {
    const chain = resolveInheritedVariables(environmentId, environments);
    return chain.some((link) => link.variables["BASE_URL"] !== undefined) ? "{{env.BASE_URL}}/" : "https://";
  }, [environmentId, environments]);

  const onStart = useCallback(
    (startUrl: string) => {
      if (workflowId === undefined || workspaceId === undefined) return;
      void useBrowserRecordingStore
        .getState()
        .start({ workspaceId, workflowId, environmentId, startUrl }, anchorFor(nodesRef.current), recordingLabel());
    },
    [environmentId, nodesRef, workflowId, workspaceId],
  );

  const busy = phase !== "idle";
  return {
    control: {
      state: busy && !isThisWorkflow ? "elsewhere" : phase,
      stepCount: isThisWorkflow ? stepCount : 0,
      disabled: isRunning || !isHydrated || workflowId === undefined || workspaceId === undefined,
      onRecord: () => setDialogOpen(true),
      onStop: () => void useBrowserRecordingStore.getState().stop(),
    },
    dialog: { open: dialogOpen, defaultUrl, onClose: () => setDialogOpen(false), onStart },
  };
}
