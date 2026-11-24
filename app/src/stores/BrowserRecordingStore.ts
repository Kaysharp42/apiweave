import { create } from "zustand";
import { toast } from "sonner";
import type { BrowserRecordingEvent } from "@shared/types/BrowserRecordingEvent";
import type { BrowserRecordingRequest } from "@shared/types/BrowserRecordingRequest";
import type { BrowserRecordingStatus } from "@shared/types/BrowserRecordingStatus";
import type { BrowserReplayRequest } from "@shared/types/BrowserReplayRequest";
import type { RecordedBrowserStep } from "@shared/types/RecordedBrowserStep";
import type { PickedBrowserElement } from "../types/PickedBrowserElement";
import type { RecordingPhase } from "../types/RecordingPhase";
import { browser } from "../utils/apiweaveClient";

interface BrowserRecordingState {
  readonly phase: RecordingPhase;
  /** Stop has been pressed: the phase stays put until `ended`, so what it interrupted is still known. */
  readonly stopping: boolean;
  /** What is running: a recording from a start address, a re-record from a step, a record after one, or a re-pick. */
  readonly operation: BrowserRecordingStatus["operation"];
  /** The step a re-record replaces from, a record-after records after, or a re-pick picks for. */
  readonly nodeId: string | null;
  /** The workflow being recorded into, from the moment the user starts. */
  readonly workflowId: string | null;
  /** Known from the first event or from the start's answer, whichever comes first. */
  readonly recordingId: string | null;
  /** The node the steps follow: a record-after's step from the start. Null after a renderer reload, and for a re-record until its first step: the canvas works it out. */
  readonly anchorId: string | null;
  /** The frame the steps go in, once a re-record has put them back in the frame of the step it replaces; null otherwise, and the canvas names one after the recording. */
  readonly frameId: string | null;
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
  /**
   * The element a re-pick picked, until the canvas of its workflow puts it on
   * the step. Held here rather than applied where the pick started, because
   * that canvas may have been closed or reloaded while the user picked.
   */
  readonly picked: PickedBrowserElement | null;
  start(request: BrowserRecordingRequest, anchorId: string | null, frameLabel: string): Promise<void>;
  /** Replay up to a step, then record from there; the steps replace that step and the ones after it. */
  rerecord(request: BrowserReplayRequest, frameLabel: string): Promise<void>;
  /** Replay through a step, then record from there; the steps go after that step, which stays. */
  recordAfter(request: BrowserReplayRequest, frameLabel: string): Promise<void>;
  /** Replay up to a step, then let the user pick its element; it arrives as a `picked` event. */
  repick(request: BrowserReplayRequest): Promise<void>;
  stop(): Promise<void>;
  setPlaced(steps: readonly RecordedBrowserStep[]): void;
  /** Where a re-record's steps go, once the canvas has taken out the steps they replace. */
  setAnchor(anchorId: string, frameId: string | null): void;
  /** Take the picked element to apply it, so a second canvas — or a second effect run — finds none. */
  takePicked(): PickedBrowserElement | null;
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
    stopping: false,
    operation,
    workflowId,
    nodeId: fields.nodeId ?? null,
    recordingId: null,
    anchorId: fields.anchorId ?? null,
    frameId: null,
    frameLabel: fields.frameLabel ?? "Recording",
    steps: [],
    placedSteps: [],
    picked: null,
  };
}

const messageOf = (error: unknown, fallback: string): string => (error instanceof Error ? error.message : fallback);

/**
 * The recording in progress, app-wide: there is at most one, and a re-pick or
 * a re-record takes the same slot. Main sends its steps on a privileged
 * channel; the canvas of the workflow being recorded places them
 * (`useBrowserRecording`). Steps outlive the recording until a new one starts,
 * so a canvas that was not open when they arrived still gets them. A re-pick's
 * element is held the same way, and only the canvas of its workflow applies it.
 */
export const useBrowserRecordingStore = create<BrowserRecordingState>()((set, get) => ({
  phase: "idle",
  stopping: false,
  operation: "record",
  nodeId: null,
  workflowId: null,
  recordingId: null,
  anchorId: null,
  frameId: null,
  frameLabel: "Recording",
  steps: [],
  placedSteps: [],
  picked: null,

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
    await recordAfterReplay(() => browser.rerecordFrom(request), "The steps could not be re-recorded");
  },

  recordAfter: async (request, frameLabel) => {
    // The anchor is known from the start: nothing is taken out first, as a re-record does.
    const fields = { nodeId: request.nodeId, anchorId: request.nodeId, frameLabel };
    if (!claim(fresh("record-after", "replaying", request.workflowId, fields))) return;
    await recordAfterReplay(() => browser.recordAfter(request), "The steps could not be recorded");
  },

  repick: async (request) => {
    if (!claim(fresh("repick", "replaying", request.workflowId, { nodeId: request.nodeId }))) return;
    try {
      await browser.repickElement(request);
    } catch (error) {
      toast.error(messageOf(error, "The element could not be re-picked"));
    } finally {
      if (get().operation === "repick") set({ phase: "idle", stopping: false });
    }
  },

  stop: async () => {
    const { phase, stopping } = get();
    if (stopping || (phase !== "recording" && phase !== "replaying" && phase !== "picking")) return;
    set({ stopping: true });
    try {
      await browser.stopRecording();
    } catch (error) {
      set({ stopping: false });
      toast.error(messageOf(error, "The recording could not be stopped"));
    }
  },

  setPlaced: (steps) => set({ placedSteps: steps }),
  setAnchor: (anchorId, frameId) => set({ anchorId, frameId }),
  takePicked: () => {
    const { picked } = get();
    if (picked !== null) set({ picked: null });
    return picked;
  },
}));

/** A re-record's or a record-after's replay, then its recording: the slot moves to `recording` once main has attached. */
async function recordAfterReplay(begin: () => Promise<BrowserRecordingStatus | null>, failure: string): Promise<void> {
  try {
    const status = await begin();
    // Null: stopped during the replay, and `ended` has already said so.
    const state = useBrowserRecordingStore.getState();
    if (status !== null && state.phase === "replaying" && !state.stopping) {
      useBrowserRecordingStore.setState({ phase: "recording", recordingId: status.recordingId });
    }
  } catch (error) {
    useBrowserRecordingStore.setState({ phase: "idle" });
    toast.error(messageOf(error, failure));
  }
}

/** Take the one slot for a new operation, unless one is already running. */
function claim(state: Partial<BrowserRecordingState>): boolean {
  if (useBrowserRecordingStore.getState().phase !== "idle") return false;
  subscribeToRecording();
  useBrowserRecordingStore.setState(state);
  return true;
}

/** What the user hears when a recording, a re-record or a record-after ends; a re-pick, or one stopped before it recorded, says nothing. */
function announceEnd(state: BrowserRecordingState): void {
  if (state.operation === "repick") return;
  // A replay the user did not stop that ended here recorded nothing either.
  if (state.phase === "replaying" && !state.stopping) return;
  const count = state.steps.length;
  if (state.operation === "rerecord" && count === 0) {
    toast.info("Nothing was re-recorded, so the steps are unchanged");
    return;
  }
  if (state.operation === "record-after" && count === 0) {
    toast.info("Nothing was recorded, so the steps are unchanged");
    return;
  }
  toast.success(count === 1 ? "Recorded 1 step" : `Recorded ${count} steps`);
}

function receive(event: BrowserRecordingEvent): void {
  const state = useBrowserRecordingStore.getState();
  // Only one recording runs at a time; anything else is a late event from one already over.
  if (state.workflowId !== event.workflowId) return;
  if (state.recordingId !== null && state.recordingId !== event.recordingId) return;
  if (event.kind === "picked") {
    // Not gated on the phase: this can land a tick after the request resolved,
    // when the slot is already idle, and losing it would lose the user's pick.
    useBrowserRecordingStore.setState({ picked: { workflowId: event.workflowId, nodeId: event.nodeId, locator: event.locator } });
    return;
  }
  if (state.phase === "idle") return;
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
      if (state.phase === "replaying" && !state.stopping) {
        useBrowserRecordingStore.setState({ phase: state.operation === "repick" ? "picking" : "recording", recordingId });
      }
      return;
    case "ended":
      useBrowserRecordingStore.setState({ phase: "idle", stopping: false, recordingId });
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
        frameId: null,
      });
    },
    () => undefined,
  );
}
