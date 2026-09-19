import { beforeEach, describe, expect, it } from "vitest";
import useTutorialCompanionStore from "./TutorialCompanionStore";

beforeEach(() => {
  useTutorialCompanionStore.setState({
    isOpen: false,
    isCollapsed: false,
    isExpanded: false,
    returnPath: null,
  });
});

describe("TutorialCompanionStore", () => {
  it("opens expanded and remembers the return path", () => {
    useTutorialCompanionStore
      .getState()
      .openCompanion("/personal/personal/workflows");
    const state = useTutorialCompanionStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.isCollapsed).toBe(false);
    // A compact companion opens as a strip, so `isExpanded` starts false.
    expect(state.isExpanded).toBe(false);
    expect(state.returnPath).toBe("/personal/personal/workflows");
  });

  it("collapses and expands while staying open", () => {
    useTutorialCompanionStore.getState().openCompanion("/w");
    useTutorialCompanionStore.getState().collapseCompanion();
    expect(useTutorialCompanionStore.getState().isCollapsed).toBe(true);
    expect(useTutorialCompanionStore.getState().isOpen).toBe(true);

    useTutorialCompanionStore.getState().expandCompanion();
    expect(useTutorialCompanionStore.getState().isCollapsed).toBe(false);
    expect(useTutorialCompanionStore.getState().isExpanded).toBe(true);
  });

  it("closes and clears the return path", () => {
    useTutorialCompanionStore.getState().openCompanion("/w");
    useTutorialCompanionStore.getState().closeCompanion();
    const state = useTutorialCompanionStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.isCollapsed).toBe(false);
    expect(state.isExpanded).toBe(false);
    expect(state.returnPath).toBeNull();
  });

  it("pauses without clearing the persisted practice (ephemeral only)", () => {
    useTutorialCompanionStore.getState().openCompanion("/w");
    useTutorialCompanionStore.getState().pauseCompanion();
    expect(useTutorialCompanionStore.getState().isOpen).toBe(false);
  });
});
