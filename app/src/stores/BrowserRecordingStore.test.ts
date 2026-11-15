import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { BrowserRecordingEvent } from "@shared/types/BrowserRecordingEvent";
import { browser } from "../utils/apiweaveClient";
import { useBrowserRecordingStore } from "./BrowserRecordingStore";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
vi.mock("../utils/apiweaveClient", () => ({
  browser: { startRecording: vi.fn(), stopRecording: vi.fn(), recordingStatus: vi.fn(), onRecording: vi.fn() },
}));

const request = { workspaceId: "ws", workflowId: "wf", environmentId: null, startUrl: "https://dev.test/" };
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
    vi.mocked(browser.startRecording).mockResolvedValue({ recordingId: "recording-1", workspaceId: "ws", workflowId: "wf" });
    vi.mocked(browser.stopRecording).mockResolvedValue(undefined);
    useBrowserRecordingStore.setState({ phase: "idle", workflowId: null, recordingId: null, anchorId: null, steps: [], insertedStepIds: [] });
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
    let answer: (value: { recordingId: string; workspaceId: string; workflowId: string }) => void = () => undefined;
    vi.mocked(browser.startRecording).mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const starting = useBrowserRecordingStore.getState().start(request, null, "Recording");
    emit(step("a", "https://dev.test/"));
    answer({ recordingId: "recording-1", workspaceId: "ws", workflowId: "wf" });
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
});
