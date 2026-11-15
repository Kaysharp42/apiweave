import { create } from "zustand";
import { toast } from "sonner";
import type { BrowserRecordingEvent } from "@shared/types/BrowserRecordingEvent";
import type { BrowserRecordingRequest } from "@shared/types/BrowserRecordingRequest";
import type { RecordedBrowserStep } from "@shared/types/RecordedBrowserStep";
import type { RecordingPhase } from "../types/RecordingPhase";
import { browser } from "../utils/apiweaveClient";

interface BrowserRecordingState {
  readonly phase: RecordingPhase;
  /** The workflow being recorded into, from the moment the user starts. */
  readonly workflowId: string | null;
  /** Known from the first event or from the start's answer, whichever comes first. */
  readonly recordingId: string | null;
  /** The node the steps follow. Null after a renderer reload: the canvas works it out. */
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
  stop(): Promise<void>;
  setPlaced(steps: readonly RecordedBrowserStep[]): void;
}

let subscribed = false;

/**
 * The recording in progress, app-wide: there is at most one. Main sends its
 * steps on a privileged channel; the canvas of the workflow being recorded
 * places them (`useBrowserRecording`). Steps outlive the recording until a new
 * one starts, so a canvas that was not open when they arrived still gets them.
 */
export const useBrowserRecordingStore = create<BrowserRecordingState>()((set, get) => ({
  phase: "idle",
  workflowId: null,
  recordingId: null,
  anchorId: null,
  frameLabel: "Recording",
  steps: [],
  placedSteps: [],

  start: async (request, anchorId, frameLabel) => {
    if (get().phase !== "idle") return;
    subscribeToRecording();
    set({ phase: "starting", workflowId: request.workflowId, recordingId: null, anchorId, frameLabel, steps: [], placedSteps: [] });
    try {
      const status = await browser.startRecording(request);
      // The user may already have closed the browser: `ended` came first.
      if (get().phase === "starting") set({ phase: "recording", recordingId: status.recordingId });
    } catch (error) {
      set({ phase: "idle" });
      toast.error(error instanceof Error ? error.message : "The recording could not start");
    }
  },

  stop: async () => {
    if (get().phase !== "recording") return;
    set({ phase: "stopping" });
    try {
      await browser.stopRecording();
    } catch (error) {
      set({ phase: "recording" });
      toast.error(error instanceof Error ? error.message : "The recording could not be stopped");
    }
  },

  setPlaced: (steps) => set({ placedSteps: steps }),
}));

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
    case "ended": {
      useBrowserRecordingStore.setState({ phase: "idle", recordingId });
      const count = state.steps.length;
      toast.success(count === 1 ? "Recorded 1 step" : `Recorded ${count} steps`);
      return;
    }
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
      useBrowserRecordingStore.setState({ phase: "recording", workflowId: status.workflowId, recordingId: status.recordingId, anchorId: null });
    },
    () => undefined,
  );
}
