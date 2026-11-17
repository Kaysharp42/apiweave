import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { subscribeToRecording, useBrowserRecordingStore } from "../stores/BrowserRecordingStore";
import useEnvironmentStore from "../stores/EnvironmentStore";
import type { BrowserRecordingStatus } from "@shared/types/BrowserRecordingStatus";
import type { RecordedBrowserStep } from "@shared/types/RecordedBrowserStep";
import type { CanvasGraph } from "../types/CanvasGraph";
import type { CanvasNode } from "../types/CanvasNode";
import type { RecordingPlacement } from "../types/RecordingPlacement";
import type { UseBrowserRecordingParams } from "../types/UseBrowserRecordingParams";
import type { UseBrowserRecordingResult } from "../types/UseBrowserRecordingResult";
import { isFrameNode } from "../utils/canvasGroups";
import { resolveInheritedVariables } from "../utils/environmentInheritance";
import { isRecordControlDisabled, recordingControlView } from "../utils/recordingControl";
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
 * The recording's steps the canvas has not applied yet. What an earlier mount
 * already placed survives in the store, so a step that has not changed since is
 * left alone instead of overwriting the user's edits.
 */
function pendingSteps(
  steps: readonly RecordedBrowserStep[],
  placedSteps: readonly RecordedBrowserStep[],
): RecordedBrowserStep[] {
  const placedById = new Map(placedSteps.map((entry) => [entry.stepId, entry] as const));
  return steps.filter((step) => placedById.get(step.stepId) !== step);
}

function placementIn(anchorId: string, recordingId: string, frameLabel: string): RecordingPlacement {
  return { anchorId, frameId: `frame-${recordingId}`, frameLabel };
}

/**
 * The graph the pending steps go onto, where they go, and the anchor to
 * remember when a re-record moved it. A re-record's first step takes out the
 * steps it replaces, in the same edit as the step itself.
 */
function planPlacement(
  graph: CanvasGraph,
  store: ReturnType<typeof useBrowserRecordingStore.getState>,
  recordingId: string,
): { graph: CanvasGraph; placement: RecordingPlacement; replacedAnchorId: string | null } {
  const replaced = store.anchorId === null ? replaceForRerecord(graph, store.operation, store.nodeId) : null;
  if (replaced !== null) {
    return {
      graph: replaced.graph,
      placement: placementIn(replaced.anchorId, recordingId, store.frameLabel),
      replacedAnchorId: replaced.anchorId,
    };
  }
  const anchorId = store.anchorId ?? resumedAnchor(graph.nodes, recordingId) ?? "";
  return { graph, placement: placementIn(anchorId, recordingId, store.frameLabel), replacedAnchorId: null };
}

/**
 * Put the pending steps on the canvas one by one. A step the store already
 * knows is replaced where it is, a new one is appended, so its list keeps the
 * order the canvas placed them in.
 */
function placePendingSteps(
  graph: CanvasGraph,
  pending: readonly RecordedBrowserStep[],
  placement: RecordingPlacement,
  placedSteps: readonly RecordedBrowserStep[],
): { graph: CanvasGraph; placed: RecordedBrowserStep[] } {
  const inserted = placedSteps.map((entry) => entry.stepId);
  const placed = [...placedSteps];
  let current = graph;
  for (const step of pending) {
    current = placeRecordedStep(current, step, placement, inserted);
    const at = inserted.indexOf(step.stepId);
    if (at === -1) {
      inserted.push(step.stepId);
      placed.push(step);
    } else {
      placed[at] = step;
    }
  }
  return { graph: current, placed };
}

/**
 * Put the recording's steps on this canvas as they arrive, when it is the
 * workflow being recorded. Through `setNodes`/`setEdges` like any other edit,
 * so auto-save persists the steps and undo takes them back.
 */
function usePlaceRecordedSteps(
  isThisWorkflow: boolean,
  { isHydrated, nodesRef, edgesRef, setNodes, setEdges }: UseBrowserRecordingParams,
): void {
  // Both fields are compared by identity: the recording's id is a primitive and
  // `steps` is replaced on every edit, so this re-renders exactly when the two
  // separate subscriptions did.
  const { recordingId, steps } = useBrowserRecordingStore(
    useShallow((state) => ({ recordingId: state.recordingId, steps: state.steps })),
  );

  useEffect(() => {
    if (!isHydrated || !isThisWorkflow || recordingId === null) return;
    const store = useBrowserRecordingStore.getState();
    const pending = pendingSteps(steps, store.placedSteps);
    if (pending.length === 0) return;
    const plan = planPlacement({ nodes: nodesRef.current, edges: edgesRef.current }, store, recordingId);
    if (plan.replacedAnchorId !== null) store.setAnchor(plan.replacedAnchorId);
    const result = placePendingSteps(plan.graph, pending, plan.placement, store.placedSteps);
    // A save reads the refs: set them first, so Ctrl+S right after a step keeps it.
    nodesRef.current = result.graph.nodes;
    edgesRef.current = result.graph.edges;
    setNodes(result.graph.nodes);
    setEdges(result.graph.edges);
    store.setPlaced(result.placed);
  }, [edgesRef, isHydrated, isThisWorkflow, nodesRef, recordingId, setEdges, setNodes, steps]);
}

/**
 * Recording a page into this workflow: the Record control's state, the start
 * dialog, and placing each step on the canvas as it arrives.
 */
export function useBrowserRecording(params: UseBrowserRecordingParams): UseBrowserRecordingResult {
  const { workflowId, workspaceId, environmentId, isHydrated, isRunning, nodesRef } = params;
  // One selector rather than four. `useShallow` compares the four primitive
  // fields, so the object changes identity exactly when one of them does —
  // the same re-renders the four subscriptions produced, in one hook call.
  const { phase, stopping, recordingWorkflowId, stepCount } = useBrowserRecordingStore(
    useShallow((state) => ({
      phase: state.phase,
      stopping: state.stopping,
      recordingWorkflowId: state.workflowId,
      stepCount: state.steps.length,
    })),
  );
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

  return {
    control: {
      ...recordingControlView(phase, isThisWorkflow, stopping, stepCount),
      disabled: isRecordControlDisabled(isRunning, isHydrated, workflowId, workspaceId),
      onRecord: () => setDialogOpen(true),
      onStop: () => void useBrowserRecordingStore.getState().stop(),
    },
    dialog: { open: dialogOpen, defaultUrl, onClose: () => setDialogOpen(false), onStart },
  };
}
