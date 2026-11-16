import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MutableRefObject } from "react";
import { toast } from "sonner";
import { useBrowserRecordingStore } from "../stores/BrowserRecordingStore";
import type { CanvasEdge } from "../types/CanvasEdge";
import type { CanvasNode } from "../types/CanvasNode";
import { browser } from "../utils/apiweaveClient";
import { useStepReplay } from "./useStepReplay";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
vi.mock("../utils/apiweaveClient", () => ({
  browser: {
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    recordingStatus: vi.fn(),
    onRecording: vi.fn(),
    repickElement: vi.fn(),
    rerecordFrom: vi.fn(),
  },
}));

const open: CanvasNode = { id: "open", type: "browser", position: { x: 0, y: 0 }, data: { label: "Open a page", config: { action: "navigate", url: "https://dev.test/" } } };
const remove: CanvasNode = {
  id: "delete",
  type: "browser",
  position: { x: 0, y: 0 },
  data: { label: "Click", config: { action: "click", locator: { kind: "role", role: "button", name: "Delete" }, dialog: "accept", timeoutMs: 5_000 } },
};
const edges: CanvasEdge[] = [{ id: "open-delete", source: "open", target: "delete" }];

function setup(save: () => Promise<boolean> = async () => true) {
  const nodesRef: MutableRefObject<CanvasNode[]> = { current: [open, remove] };
  const edgesRef: MutableRefObject<CanvasEdge[]> = { current: edges };
  const setNodes = vi.fn((next: CanvasNode[]) => void (nodesRef.current = next));
  const saveWorkflowRef = { current: vi.fn(save) };
  const { result } = renderHook(() =>
    useStepReplay({ workflowId: "wf", workspaceId: "ws", environmentId: "env", isHydrated: true, isRunning: false, nodesRef, edgesRef, setNodes, saveWorkflowRef }),
  );
  return { result, nodesRef, setNodes, saveWorkflowRef };
}

describe("useStepReplay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(browser.recordingStatus).mockResolvedValue(null);
    vi.mocked(browser.onRecording).mockReturnValue(() => undefined);
    useBrowserRecordingStore.setState({ phase: "idle", workflowId: null, recordingId: null, anchorId: null, steps: [], placedSteps: [] });
  });

  it("offers re-pick and re-record on a step with a page opened before it", () => {
    const { result } = setup();
    expect(result.current.canRepick("delete")).toBe(true);
    expect(result.current.canRerecord("delete")).toBe(true);
    expect(result.current.canRepick("open")).toBe(false);
  });

  it("saves first, then puts the picked element on the step and changes nothing else", async () => {
    vi.mocked(browser.repickElement).mockResolvedValue({ kind: "role", role: "button", name: "Remove" });
    const { result, nodesRef, saveWorkflowRef } = setup();
    act(() => result.current.repick("delete"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("The step now uses the element you picked"));
    expect(saveWorkflowRef.current).toHaveBeenCalledWith(false);
    expect(browser.repickElement).toHaveBeenCalledWith({ workspaceId: "ws", workflowId: "wf", environmentId: "env", nodeId: "delete" });
    expect(nodesRef.current[0]).toBe(open);
    expect(nodesRef.current[1]?.data).toEqual({
      label: "Click",
      config: { action: "click", locator: { kind: "role", role: "button", name: "Remove" }, dialog: "accept", timeoutMs: 5_000 },
    });
  });

  it("replays nothing when the save is refused", async () => {
    const { result, setNodes } = setup(async () => false);
    act(() => result.current.repick("delete"));
    await waitFor(() => expect(useBrowserRecordingStore.getState().phase).toBe("idle"));
    expect(browser.repickElement).not.toHaveBeenCalled();
    expect(setNodes).not.toHaveBeenCalled();
  });

  it("does not bring back a step deleted while the user picked", async () => {
    const { result, nodesRef, setNodes } = setup();
    vi.mocked(browser.repickElement).mockImplementation(async () => {
      nodesRef.current = [open];
      return { kind: "role", role: "button", name: "Remove" };
    });
    act(() => result.current.repick("delete"));
    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect(setNodes).not.toHaveBeenCalled();
  });
});
