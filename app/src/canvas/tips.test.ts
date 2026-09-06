import { describe, expect, it } from "vitest";
import { selectCanvasTip } from "./tips";
import type { CanvasTipContext } from "../types/CanvasTipContext";

const idleContext: CanvasTipContext = {
  isRunning: false,
  canGroup: false,
  canUngroup: false,
  canUndo: false,
  hasUnconnectedNode: false,
};

describe("selectCanvasTip", () => {
  it("prioritizes the contextual frame gesture", () => {
    expect(
      selectCanvasTip(
        { ...idleContext, canGroup: true, canUndo: true },
        new Set(),
      )?.id,
    ).toBe("group-selection");
  });

  it("never repeats a dismissed tip and suppresses tips during runs", () => {
    expect(
      selectCanvasTip(
        { ...idleContext, canGroup: true, canUndo: true },
        new Set(["group-selection"]),
      )?.id,
    ).toBe("undo");
    expect(
      selectCanvasTip({ ...idleContext, canGroup: true, isRunning: true }, new Set()),
    ).toBeNull();
  });
});
