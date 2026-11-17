import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { subscribeToRecording, useBrowserRecordingStore } from "../stores/BrowserRecordingStore";
import useEnvironmentStore from "../stores/EnvironmentStore";
import type { BrowserRecordingStatus } from "@shared/types/BrowserRecordingStatus";
import type { CanvasGraph } from "../types/CanvasGraph";
import type { CanvasNode } from "../types/CanvasNode";
import type { RecordingPlacement } from "../types/RecordingPlacement";
import type { UseBrowserRecordingParams } from "../types/UseBrowserRecordingParams";
import type { UseBrowserRecordingResult } from "../types/UseBrowserRecordingResult";
import { isFrameNode } from "../utils/canvasGroups";
import { resolveInheritedVariables } from "../utils/environmentInheritance";
import { placeRecordedStep } from "../utils/recordedSteps";
import { removeStepsFrom } from "../utils/stepReplay";

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

/**
 * Before a re-record's first step: take out the steps it replaces, in the
 * same edit as the step, so one undo puts them back, and say where its steps
 * go. Null when this is not a re-record's first step — or its step is gone
 * already, because a reloaded canvas placed some of them before.
 */
function replaceForRerecord(
  graph: CanvasGraph,
  operation: BrowserRecordingStatus["operation"],
  nodeId: string | null,
): { graph: CanvasGraph; anchorId: string } | null {
  if (operation !== "rerecord" || nodeId === null || !graph.nodes.some((node) => node.id === nodeId)) return null;
  const removed = removeStepsFrom(graph, nodeId);
  if (removed !== null) return removed;
  toast.warning("The steps around this one changed during the replay, so the new steps were added after it instead of replacing it.");
  return { graph, anchorId: nodeId };
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
    let graph: CanvasGraph = { nodes: nodesRef.current, edges: edgesRef.current };
    let anchorId = store.anchorId;
    const replaced = anchorId === null ? replaceForRerecord(graph, store.operation, store.nodeId) : null;
    if (replaced !== null) {
      ({ graph, anchorId } = replaced);
      store.setAnchor(replaced.anchorId);
    }
    anchorId ??= resumedAnchor(graph.nodes, recordingId);
    const placement: RecordingPlacement = { anchorId: anchorId ?? "", frameId: `frame-${recordingId}`, frameLabel: store.frameLabel };
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
  const stopping = useBrowserRecordingStore((state) => state.stopping);
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
      stopping: isThisWorkflow && stopping,
      stepCount: isThisWorkflow ? stepCount : 0,
      disabled: isRunning || !isHydrated || workflowId === undefined || workspaceId === undefined,
      onRecord: () => setDialogOpen(true),
      onStop: () => void useBrowserRecordingStore.getState().stop(),
    },
    dialog: { open: dialogOpen, defaultUrl, onClose: () => setDialogOpen(false), onStart },
  };
}
