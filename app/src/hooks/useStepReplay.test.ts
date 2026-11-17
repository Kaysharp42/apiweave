import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode, type MutableRefObject } from "react";
import { toast } from "sonner";
import type { BrowserLocator } from "@shared/types/BrowserLocator";
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
const picked: BrowserLocator = { kind: "role", role: "button", name: "Remove" };

function setup(options: { save?: () => Promise<boolean>; hydrated?: boolean; workflowId?: string; strict?: boolean } = {}) {
  const nodesRef: MutableRefObject<CanvasNode[]> = { current: [open, remove] };
  const edgesRef: MutableRefObject<CanvasEdge[]> = { current: edges };
  const setNodes = vi.fn((next: CanvasNode[]) => void (nodesRef.current = next));
  const saveWorkflowRef = { current: vi.fn(options.save ?? (async () => true)) };
  const { result, rerender, unmount } = renderHook(
    ({ hydrated }: { hydrated: boolean }) =>
      useStepReplay({
        workflowId: options.workflowId ?? "wf",
        workspaceId: "ws",
        environmentId: "env",
        isHydrated: hydrated,
        isRunning: false,
        nodesRef,
        edgesRef,
        setNodes,
        saveWorkflowRef,
      }),
    { initialProps: { hydrated: options.hydrated ?? true }, ...(options.strict === true ? { wrapper: StrictMode } : {}) },
  );
  return { result, rerender, unmount, nodesRef, setNodes, saveWorkflowRef };
}

/** The picked event's effect on the store, as the store's `receive` would leave it. */
function holdPick(locator: BrowserLocator = picked, workflowId = "wf", nodeId = "delete"): void {
  act(() => useBrowserRecordingStore.setState({ picked: { workflowId, nodeId, locator } }));
}

describe("useStepReplay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(browser.recordingStatus).mockResolvedValue(null);
    vi.mocked(browser.onRecording).mockReturnValue(() => undefined);
    useBrowserRecordingStore.setState({ phase: "idle", stopping: false, workflowId: null, recordingId: null, anchorId: null, steps: [], placedSteps: [], picked: null });
  });

  it("offers re-pick and re-record on a step with a page opened before it", () => {
    const { result } = setup();
    expect(result.current.canRepick("delete")).toBe(true);
    expect(result.current.canRerecord("delete")).toBe(true);
    expect(result.current.canRepick("open")).toBe(false);
  });

  it("saves first, then puts the picked element on the step and changes nothing else", async () => {
    vi.mocked(browser.repickElement).mockResolvedValue(undefined);
    const { result, nodesRef, saveWorkflowRef } = setup();
    act(() => result.current.repick("delete"));
    await waitFor(() => expect(browser.repickElement).toHaveBeenCalled());

    holdPick();

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("The step now uses the element you picked"));
    expect(saveWorkflowRef.current).toHaveBeenCalledWith(false);
    expect(browser.repickElement).toHaveBeenCalledWith({ workspaceId: "ws", workflowId: "wf", environmentId: "env", nodeId: "delete" });
    expect(nodesRef.current[0]).toBe(open);
    expect(nodesRef.current[1]?.data).toEqual({
      label: "Click",
      config: { action: "click", locator: picked, dialog: "accept", timeoutMs: 5_000 },
    });
    // Held once, so a canvas that mounts later does not apply it again.
    expect(useBrowserRecordingStore.getState().picked).toBeNull();
  });

  it("replays nothing when the save is refused", async () => {
    const { result, saveWorkflowRef, setNodes } = setup({ save: async () => false });
    act(() => result.current.repick("delete"));
    await waitFor(() => expect(saveWorkflowRef.current).toHaveBeenCalled());
    expect(browser.repickElement).not.toHaveBeenCalled();
    expect(setNodes).not.toHaveBeenCalled();
  });

  it("does not bring back a step deleted while the user picked", async () => {
    vi.mocked(browser.repickElement).mockResolvedValue(undefined);
    const { result, nodesRef, setNodes } = setup();
    act(() => result.current.repick("delete"));
    await waitFor(() => expect(browser.repickElement).toHaveBeenCalled());
    nodesRef.current = [open];

    holdPick();

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith("The step was deleted while you picked, so the element was not saved."));
    expect(setNodes).not.toHaveBeenCalled();
    expect(useBrowserRecordingStore.getState().picked).toBeNull();
  });

  it("applies a pick made while no canvas was open, once, when a canvas mounts", () => {
    holdPick();
    const { setNodes } = setup({ strict: true });
    expect(setNodes).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.warning).not.toHaveBeenCalled();
    expect(useBrowserRecordingStore.getState().picked).toBeNull();
  });

  it("leaves another workflow's pick for that workflow's canvas", () => {
    holdPick(picked, "other");
    const { setNodes } = setup();
    expect(setNodes).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(useBrowserRecordingStore.getState().picked).not.toBeNull();
  });

  it("waits for the canvas to be hydrated before applying a pick", async () => {
    const { setNodes, rerender } = setup({ hydrated: false });
    holdPick();
    expect(setNodes).not.toHaveBeenCalled();
    expect(useBrowserRecordingStore.getState().picked).not.toBeNull();

    rerender({ hydrated: true });
    await waitFor(() => expect(setNodes).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith("The step now uses the element you picked");
  });
});
