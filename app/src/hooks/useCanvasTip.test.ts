import { beforeEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCanvasTip } from "./useCanvasTip";
import type { CanvasTipContext } from "../types/CanvasTipContext";

const idleContext: CanvasTipContext = {
  isRunning: false,
  canGroup: false,
  canUngroup: false,
  canUndo: false,
  hasUnconnectedNode: false,
};

describe("useCanvasTip", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("clears the tip as soon as a run starts", () => {
    const { result, rerender } = renderHook(
      (context: CanvasTipContext) => useCanvasTip(context),
      { initialProps: { ...idleContext, canGroup: true } },
    );

    expect(result.current.tip?.id).toBe("group-selection");

    // No waiting out SETTLE_MS: a run must not leave the tip under the camera.
    rerender({ ...idleContext, canGroup: true, isRunning: true });

    expect(result.current.tip).toBeNull();
  });
});
