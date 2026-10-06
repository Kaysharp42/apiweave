import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import useAutoSave from "./useAutoSave";

interface Props {
  nodes: unknown[];
  saveWorkflow: (silent: boolean) => Promise<void>;
}

const vars = {};

function setup(initialSave: Props["saveWorkflow"]) {
  return renderHook(
    ({ nodes, saveWorkflow }: Props) =>
      useAutoSave({
        workflowId: "wf1",
        autoSaveEnabled: true,
        nodes,
        edges: [],
        workflowVariables: vars,
        saveWorkflow,
      }),
    { initialProps: { nodes: [{ id: "a", data: {} }], saveWorkflow: initialSave } },
  );
}

describe("useAutoSave", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("saves after the debounce", () => {
    const save = vi.fn(() => Promise.resolve());
    const hook = setup(save);
    hook.rerender({ nodes: [{ id: "a", data: {} }, { id: "b", data: {} }], saveWorkflow: save });
    expect(save).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(700));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(true);
  });

  it("sends a pending save on unmount, through the latest saveWorkflow, exactly once", () => {
    const stale = vi.fn(() => Promise.resolve());
    const latest = vi.fn(() => Promise.resolve());
    const hook = setup(stale);
    hook.rerender({ nodes: [{ id: "a", data: {} }, { id: "b", data: {} }], saveWorkflow: stale });
    // A re-render that only swaps the save closure (as a canvas does when the
    // tab's workflow updates) must not drop or reset the pending save.
    hook.rerender({ nodes: [{ id: "a", data: {} }, { id: "b", data: {} }], saveWorkflow: latest });

    hook.unmount();
    expect(stale).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(2000));
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it("does not save on unmount when nothing is pending", () => {
    const save = vi.fn(() => Promise.resolve());
    const hook = setup(save);
    hook.unmount();
    expect(save).not.toHaveBeenCalled();
  });

  it("flush sends the pending save once and the timer does not repeat it", async () => {
    const save = vi.fn(() => Promise.resolve());
    const hook = setup(save);
    hook.rerender({ nodes: [{ id: "a", data: {} }, { id: "b", data: {} }], saveWorkflow: save });

    await act(() => hook.result.current());
    expect(save).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(2000));
    hook.unmount();
    expect(save).toHaveBeenCalledTimes(1);
  });
});
