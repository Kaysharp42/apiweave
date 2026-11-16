import { create } from "zustand";
import { toast } from "sonner";
import type { BrowserLocator } from "@shared/types/BrowserLocator";
import type { BrowserRecordingEvent } from "@shared/types/BrowserRecordingEvent";
import type { BrowserRecordingRequest } from "@shared/types/BrowserRecordingRequest";
import type { BrowserRecordingStatus } from "@shared/types/BrowserRecordingStatus";
import type { BrowserReplayRequest } from "@shared/types/BrowserReplayRequest";
import type { RecordedBrowserStep } from "@shared/types/RecordedBrowserStep";
import type { RecordingPhase } from "../types/RecordingPhase";
import { browser } from "../utils/apiweaveClient";

interface BrowserRecordingState {
  readonly phase: RecordingPhase;
  /** What is running: a recording from a start address, a re-record from a step, or a re-pick. */
  readonly operation: BrowserRecordingStatus["operation"];
  /** The step a re-record replaces from, or a re-pick picks for. */
  readonly nodeId: string | null;
  /** The workflow being recorded into, from the moment the user starts. */
  readonly workflowId: string | null;
  /** Known from the first event or from the start's answer, whichever comes first. */
  readonly recordingId: string | null;
  /** The node the steps follow. Null after a renderer reload, and for a re-record until its first step: the canvas works it out. */
  readonly anchorId: string | null;
  readonly frameLabel: string;
  /** In the order they first arrived, each with its latest config. */
  readonly steps: readonly RecordedBrowserStep[];
  /**
   * The steps the canvas has placed, in order, each with the exact object it
   * placed. Survives the canvas unmounting: a later mount compares each step
   * with what was placed and re-applies only the ones that changed, so it never
   * writes a recorded config back over the user's edits.
   */
  readonly placedSteps: readonly RecordedBrowserStep[];
  start(request: BrowserRecordingRequest, anchorId: string | null, frameLabel: string): Promise<void>;
  /** Replay up to a step, then record from there; the steps replace that step and the ones after it. */
  rerecord(request: BrowserReplayRequest, frameLabel: string): Promise<void>;
  /** Replay up to a step, then let the user pick its element: the new locator, or null. */
  repick(request: BrowserReplayRequest): Promise<BrowserLocator | null>;
  stop(): Promise<void>;
  setPlaced(steps: readonly RecordedBrowserStep[]): void;
  /** Where a re-record's steps go, once the canvas has taken out the steps they replace. */
  setAnchor(anchorId: string): void;
}

let subscribed = false;

/** A fresh operation's state: what an earlier one left is dropped. */
function fresh(
  operation: BrowserRecordingStatus["operation"],
  phase: RecordingPhase,
  workflowId: string,
  fields: { nodeId?: string; anchorId?: string | null; frameLabel?: string } = {},
): Partial<BrowserRecordingState> {
  return {
    phase,
    operation,
    workflowId,
    nodeId: fields.nodeId ?? null,
    recordingId: null,
    anchorId: fields.anchorId ?? null,
    frameLabel: fields.frameLabel ?? "Recording",
    steps: [],
    placedSteps: [],
  };
}

const messageOf = (error: unknown, fallback: string): string => (error instanceof Error ? error.message : fallback);

/**
 * The recording in progress, app-wide: there is at most one, and a re-pick or
 * a re-record takes the same slot. Main sends its steps on a privileged
 * channel; the canvas of the workflow being recorded places them
 * (`useBrowserRecording`). Steps outlive the recording until a new one starts,
 * so a canvas that was not open when they arrived still gets them.
 */
export const useBrowserRecordingStore = create<BrowserRecordingState>()((set, get) => ({
  phase: "idle",
  operation: "record",
  nodeId: null,
  workflowId: null,
  recordingId: null,
  anchorId: null,
  frameLabel: "Recording",
  steps: [],
  placedSteps: [],

  start: async (request, anchorId, frameLabel) => {
    if (!claim(fresh("record", "starting", request.workflowId, { anchorId, frameLabel }))) return;
    try {
      const status = await browser.startRecording(request);
      // The user may already have closed the browser: `ended` came first.
      if (get().phase === "starting") set({ phase: "recording", recordingId: status.recordingId });
    } catch (error) {
      set({ phase: "idle" });
      toast.error(messageOf(error, "The recording could not start"));
    }
  },

  rerecord: async (request, frameLabel) => {
    if (!claim(fresh("rerecord", "replaying", request.workflowId, { nodeId: request.nodeId, frameLabel }))) return;
    try {
      const status = await browser.rerecordFrom(request);
      // Null: stopped during the replay, and `ended` has already said so.
      if (status !== null && get().phase === "replaying") set({ phase: "recording", recordingId: status.recordingId });
    } catch (error) {
      set({ phase: "idle" });
      toast.error(messageOf(error, "The steps could not be re-recorded"));
    }
  },

  repick: async (request) => {
    if (!claim(fresh("repick", "replaying", request.workflowId, { nodeId: request.nodeId }))) return null;
    try {
      return await browser.repickElement(request);
    } catch (error) {
      toast.error(messageOf(error, "The element could not be re-picked"));
      return null;
    } finally {
      if (get().operation === "repick") set({ phase: "idle" });
    }
  },

  stop: async () => {
    const { phase } = get();
    if (phase !== "recording" && phase !== "replaying" && phase !== "picking") return;
    set({ phase: "stopping" });
    try {
      await browser.stopRecording();
    } catch (error) {
      set({ phase });
      toast.error(messageOf(error, "The recording could not be stopped"));
    }
  },

  setPlaced: (steps) => set({ placedSteps: steps }),
  setAnchor: (anchorId) => set({ anchorId }),
}));

/** Take the one slot for a new operation, unless one is already running. */
function claim(state: Partial<BrowserRecordingState>): boolean {
  if (useBrowserRecordingStore.getState().phase !== "idle") return false;
  subscribeToRecording();
  useBrowserRecordingStore.setState(state);
  return true;
}

/** What the user hears when a recording or a re-record ends; a re-pick, or one stopped before it recorded, says nothing. */
function announceEnd(state: BrowserRecordingState): void {
  if (state.operation === "repick" || state.phase === "replaying") return;
  const count = state.steps.length;
  if (state.operation === "rerecord" && count === 0) {
    toast.info("Nothing was re-recorded, so the steps are unchanged");
    return;
  }
  toast.success(count === 1 ? "Recorded 1 step" : `Recorded ${count} steps`);
}

function receive(event: BrowserRecordingEvent): void {
  const state = useBrowserRecordingStore.getState();
  // Only one recording runs at a time; anything else is a late event from one already over.
  if (state.phase === "idle" || state.workflowId !== event.workflowId) return;
  if (state.recordingId !== null && state.recordingId !== event.recordingId) return;
  const recordingId = event.recordingId;
  switch (event.kind) {
    case "step": {
      const index = state.steps.findIndex((step) => step.stepId === event.step.stepId);
      const steps = index === -1 ? [...state.steps, event.step] : state.steps.map((step, at) => (at === index ? event.step : step));
      useBrowserRecordingStore.setState({ steps, recordingId });
      return;
    }
    case "warning":
      toast.warning(event.message);
      return;
    case "replayed":
      if (state.phase === "replaying") {
        useBrowserRecordingStore.setState({ phase: state.operation === "repick" ? "picking" : "recording", recordingId });
      }
      return;
    case "ended":
      useBrowserRecordingStore.setState({ phase: "idle", recordingId });
      announceEnd(state);
      return;
  }
}

/**
 * Listen to main once for the life of the renderer, and pick up a recording
 * that was already running when the renderer (re)loaded, so Stop still works.
 */
export function subscribeToRecording(): void {
  if (subscribed) return;
  subscribed = true;
  browser.onRecording(receive);
  void browser.recordingStatus().then(
    (status) => {
      if (status === null || useBrowserRecordingStore.getState().phase !== "idle") return;
      useBrowserRecordingStore.setState({
        phase: status.operation === "repick" ? "picking" : "recording",
        operation: status.operation,
        nodeId: status.nodeId ?? null,
        workflowId: status.workflowId,
        recordingId: status.recordingId,
        anchorId: null,
      });
    },
    () => undefined,
  );
}
