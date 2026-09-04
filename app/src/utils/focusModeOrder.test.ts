import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { adjacentFocusModeNode, focusModeOrder, isEditableNode } from "./focusModeOrder";
import type { WorkflowCanvasNodeData } from "../types/WorkflowCanvasNodeData";

function node(id: string, executionTimestamp?: number): Node<WorkflowCanvasNodeData> {
  return {
    id,
    type: "http-request",
    position: { x: 0, y: 0 },
    data: executionTimestamp === undefined ? {} : { executionTimestamp },
  };
}

const diamondEdges: Edge[] = [
  { id: "a-b", source: "a", target: "b" },
  { id: "a-c", source: "a", target: "c" },
  { id: "b-d", source: "b", target: "d" },
  { id: "c-d", source: "c", target: "d" },
];

describe("focusModeOrder", () => {
  it("walks every editable node once through a diamond graph", () => {
    const nodes = [node("a"), node("b"), node("c"), node("d")];

    expect(focusModeOrder(nodes, diamondEdges)).toEqual(["a", "b", "c", "d"]);
    expect(adjacentFocusModeNode(nodes, diamondEdges, "b", "next")).toBe("c");
    expect(adjacentFocusModeNode(nodes, diamondEdges, "c", "previous")).toBe("b");
  });

  it("uses execution timestamps before topology when a run exists", () => {
    const nodes = [node("a", 30), node("b", 10), node("c", 20)];

    expect(focusModeOrder(nodes, diamondEdges)).toEqual(["b", "c", "a"]);
  });
});

describe("isEditableNode", () => {
  // Frames and notes are edited in place on the canvas; treating them as steps
  // is what opened an empty node-details dialog on a double-click.
  it("keeps canvas objects and the terminals out of the details editor", () => {
    expect(isEditableNode(node("a"))).toBe(true);
    for (const type of ["group", "note", "start", "end"]) {
      expect(isEditableNode({ ...node("a"), type })).toBe(false);
    }
  });
});
