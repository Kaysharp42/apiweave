import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { BrowserRecordingEvent } from "@shared/types/BrowserRecordingEvent";
import type { BrowserRecordingStatus } from "@shared/types/BrowserRecordingStatus";
import type { BrowserLocator } from "@shared/types/BrowserLocator";
import { browser } from "../utils/apiweaveClient";
import { useBrowserRecordingStore } from "./BrowserRecordingStore";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
vi.mock("../utils/apiweaveClient", () => ({
  browser: { startRecording: vi.fn(), stopRecording: vi.fn(), recordingStatus: vi.fn(), onRecording: vi.fn(), repickElement: vi.fn(), rerecordFrom: vi.fn() },
}));

const request = { workspaceId: "ws", workflowId: "wf", environmentId: null, startUrl: "https://dev.test/" };
const STATUS: BrowserRecordingStatus = { recordingId: "recording-1", workspaceId: "ws", workflowId: "wf", operation: "record" };
let emit: (event: BrowserRecordingEvent) => void = () => undefined;

const step = (stepId: string, url: string): BrowserRecordingEvent => ({
  kind: "step",
  recordingId: "recording-1",
  workflowId: "wf",
  step: { stepId, config: { action: "navigate", url } },
});

describe("useBrowserRecordingStore", () => {
  beforeEach(() => {
    vi.mocked(browser.onRecording).mockImplementation((callback) => {
      emit = callback;
      return () => undefined;
    });
    vi.mocked(browser.recordingStatus).mockResolvedValue(null);
    vi.mocked(browser.startRecording).mockResolvedValue(STATUS);
    vi.mocked(browser.stopRecording).mockResolvedValue(undefined);
    useBrowserRecordingStore.setState({ phase: "idle", workflowId: null, recordingId: null, anchorId: null, steps: [], placedSteps: [] });
  });

  it("starts, collects steps in arrival order with their latest config, and ends", async () => {
    const store = useBrowserRecordingStore.getState();
    await store.start(request, "start-1", "Recording");
    expect(browser.startRecording).toHaveBeenCalledWith(request);
    expect(useBrowserRecordingStore.getState()).toMatchObject({ phase: "recording", recordingId: "recording-1", anchorId: "start-1" });

    emit(step("a", "https://dev.test/"));
    emit(step("b", "https://dev.test/x"));
    emit(step("a", "https://dev.test/login"));
    expect(useBrowserRecordingStore.getState().steps.map((s) => [s.stepId, s.config])).toEqual([
      ["a", { action: "navigate", url: "https://dev.test/login" }],
      ["b", { action: "navigate", url: "https://dev.test/x" }],
    ]);

    emit({ kind: "warning", recordingId: "recording-1", workflowId: "wf", message: "popup" });
    expect(toast.warning).toHaveBeenCalledWith("popup");

    await useBrowserRecordingStore.getState().stop();
    expect(useBrowserRecordingStore.getState().phase).toBe("stopping");
    emit({ kind: "ended", recordingId: "recording-1", workflowId: "wf" });
    expect(useBrowserRecordingStore.getState()).toMatchObject({ phase: "idle", recordingId: "recording-1" });
    expect(toast.success).toHaveBeenCalledWith("Recorded 2 steps");
    // The steps stay for a canvas that has not placed them yet.
    expect(useBrowserRecordingStore.getState().steps).toHaveLength(2);
  });

  it("keeps a step that arrives before the start has answered", async () => {
    let answer: (value: BrowserRecordingStatus) => void = () => undefined;
    vi.mocked(browser.startRecording).mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const starting = useBrowserRecordingStore.getState().start(request, null, "Recording");
    emit(step("a", "https://dev.test/"));
    answer(STATUS);
    await starting;
    expect(useBrowserRecordingStore.getState()).toMatchObject({ phase: "recording", recordingId: "recording-1" });
    expect(useBrowserRecordingStore.getState().steps).toHaveLength(1);
  });

  it("ignores events for another workflow or another recording", async () => {
    await useBrowserRecordingStore.getState().start(request, null, "Recording");
    emit({ ...step("a", "https://dev.test/"), workflowId: "other" });
    emit({ ...step("b", "https://dev.test/"), recordingId: "recording-0" });
    expect(useBrowserRecordingStore.getState().steps).toEqual([]);
  });

  it("returns to idle and says why when the browser cannot start", async () => {
    vi.mocked(browser.startRecording).mockRejectedValue(new Error("The recording could not start: Microsoft Edge was not found on this machine."));
    await useBrowserRecordingStore.getState().start(request, null, "Recording");
    expect(useBrowserRecordingStore.getState().phase).toBe("idle");
    expect(toast.error).toHaveBeenCalledWith("The recording could not start: Microsoft Edge was not found on this machine.");
  });

  it("keeps what the canvas placed for a later mount, and clears it when another recording starts", async () => {
    await useBrowserRecordingStore.getState().start(request, null, "Recording");
    emit(step("a", "https://dev.test/"));
    const placed = useBrowserRecordingStore.getState().steps;
    useBrowserRecordingStore.getState().setPlaced(placed);

    emit({ kind: "ended", recordingId: "recording-1", workflowId: "wf" });
    // A canvas that mounts after the end still sees what was placed, so it does not place it again.
    expect(useBrowserRecordingStore.getState()).toMatchObject({ phase: "idle", placedSteps: placed });

    await useBrowserRecordingStore.getState().start(request, null, "Recording");
    expect(useBrowserRecordingStore.getState()).toMatchObject({ steps: [], placedSteps: [] });
  });
});

describe("useBrowserRecordingStore re-pick and re-record", () => {
  const replayRequest = { workspaceId: "ws", workflowId: "wf", environmentId: null, nodeId: "delete" };
  const replayed: BrowserRecordingEvent = { kind: "replayed", recordingId: "recording-2", workflowId: "wf" };
  const ended: BrowserRecordingEvent = { kind: "ended", recordingId: "recording-2", workflowId: "wf" };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(browser.onRecording).mockImplementation((callback) => {
      emit = callback;
      return () => undefined;
    });
    vi.mocked(browser.stopRecording).mockResolvedValue(undefined);
    useBrowserRecordingStore.setState({ phase: "idle", workflowId: null, recordingId: null, anchorId: null, steps: [], placedSteps: [] });
  });

  it("re-picks: replaying, then picking, then the locator, and says nothing itself", async () => {
    let answer: (locator: BrowserLocator | null) => void = () => undefined;
    vi.mocked(browser.repickElement).mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const repicking = useBrowserRecordingStore.getState().repick(replayRequest);
    expect(useBrowserRecordingStore.getState()).toMatchObject({ phase: "replaying", operation: "repick", nodeId: "delete" });
    emit(replayed);
    expect(useBrowserRecordingStore.getState().phase).toBe("picking");
    emit(ended);
    answer({ kind: "role", role: "button", name: "Remove" });
    await expect(repicking).resolves.toEqual({ kind: "role", role: "button", name: "Remove" });
    expect(useBrowserRecordingStore.getState().phase).toBe("idle");
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("says why a re-pick failed, and is idle again", async () => {
    vi.mocked(browser.repickElement).mockRejectedValue(new Error("The steps before this one did not pass."));
    await expect(useBrowserRecordingStore.getState().repick(replayRequest)).resolves.toBeNull();
    expect(toast.error).toHaveBeenCalledWith("The steps before this one did not pass.");
    expect(useBrowserRecordingStore.getState().phase).toBe("idle");
  });

  it("re-records: replaying, then recording the steps that replace the step", async () => {
    vi.mocked(browser.rerecordFrom).mockImplementation(async () => {
      emit(replayed);
      return { recordingId: "recording-2", workspaceId: "ws", workflowId: "wf", operation: "rerecord", nodeId: "delete" };
    });
    await useBrowserRecordingStore.getState().rerecord(replayRequest, "Re-recorded");
    expect(useBrowserRecordingStore.getState()).toMatchObject({
      phase: "recording",
      operation: "rerecord",
      nodeId: "delete",
      recordingId: "recording-2",
      anchorId: null,
      frameLabel: "Re-recorded",
    });
    emit({ ...step("browser-2-1", "https://dev.test/"), recordingId: "recording-2" });
    emit(ended);
    expect(toast.success).toHaveBeenCalledWith("Recorded 1 step");
  });

  it("stops a re-record during its replay, and says the steps are unchanged", async () => {
    vi.mocked(browser.rerecordFrom).mockResolvedValue(null);
    const rerecording = useBrowserRecordingStore.getState().rerecord(replayRequest, "Re-recorded");
    await useBrowserRecordingStore.getState().stop();
    expect(browser.stopRecording).toHaveBeenCalledOnce();
    emit(ended);
    await rerecording;
    expect(useBrowserRecordingStore.getState().phase).toBe("idle");
    expect(toast.info).toHaveBeenCalledWith("Nothing was re-recorded, so the steps are unchanged");
    expect(toast.success).not.toHaveBeenCalled();
  });
});
