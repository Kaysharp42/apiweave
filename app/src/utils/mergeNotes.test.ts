import { describe, expect, it } from "vitest";
import type { GitMergeNote } from "@shared/types/GitMergeNote";
import { countMergeNotes, describeAutomaticMerge } from "./mergeNotes";

describe("countMergeNotes", () => {
  it("counts each node a positions note moved, and every other note once", () => {
    const notes: readonly GitMergeNote[] = [
      { type: "positions", recordId: "w1", name: "Checkout", nodeIds: ["n1", "n2"] },
      { type: "droppedEdge", recordId: "w1", name: "Checkout", edgeId: "e1", end: "target", nodeId: "n9" },
      { type: "order", recordId: "p1", name: "Shop" },
    ];

    expect(countMergeNotes(notes)).toBe(4);
    expect(countMergeNotes([])).toBe(0);
  });

  it("says one change in the singular", () => {
    expect(describeAutomaticMerge(1)).toBe("1 change merged automatically");
    expect(describeAutomaticMerge(12)).toBe("12 changes merged automatically");
  });
});
