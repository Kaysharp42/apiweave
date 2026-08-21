import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLocalWorkflowRemovals,
  isLocalWorkflowRemoval,
  noteLocalWorkflowRemoval,
} from "./localWorkflowRemovals";

describe("localWorkflowRemovals", () => {
  beforeEach(() => {
    clearLocalWorkflowRemovals();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearLocalWorkflowRemovals();
  });

  it("does not claim an unmarked workflow", () => {
    expect(isLocalWorkflowRemoval("wf1")).toBe(false);
  });

  it("claims a marked workflow", () => {
    noteLocalWorkflowRemoval("wf1");

    expect(isLocalWorkflowRemoval("wf1")).toBe(true);
    expect(isLocalWorkflowRemoval("wf2")).toBe(false);
  });

  it("keeps claiming across repeated notifications for one logical detach", () => {
    noteLocalWorkflowRemoval("wf1");

    // A workspace move arrives twice — once for `setWorkspace`, once for the
    // `update` behind it. A mark consumed on first read would let the second
    // through.
    expect(isLocalWorkflowRemoval("wf1")).toBe(true);
    expect(isLocalWorkflowRemoval("wf1")).toBe(true);
  });

  it("expires so a request that never lands cannot silence a real detach", () => {
    noteLocalWorkflowRemoval("wf1");

    vi.advanceTimersByTime(10_001);

    expect(isLocalWorkflowRemoval("wf1")).toBe(false);
  });
});
