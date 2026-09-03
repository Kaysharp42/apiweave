import { describe, expect, it } from "vitest";
import type { CanvasNode } from "../types/CanvasNode";
import {
  GROUP_PAD,
  groupSelection,
  reconcileFrames,
  selectedFrameIds,
  sortFramesFirst,
  ungroupFrames,
  withAbsolutePositions,
} from "./canvasGroups";

function node(id: string, x: number, y: number): CanvasNode {
  return {
    id,
    type: "http-request",
    position: { x, y },
    measured: { width: 200, height: 100 },
    data: { label: id, config: {} },
  };
}

const graph = [node("a", 100, 100), node("b", 400, 260), node("c", 900, 40)];

function group(nodes: readonly CanvasNode[], ids: string[]) {
  const outcome = groupSelection(nodes, new Set(ids), { frameId: "frame-1" });
  if (!outcome.ok) throw new Error(`refused: ${outcome.reason}`);
  return outcome;
}

describe("canvasGroups", () => {
  it("frames the selection's bounding box plus padding", () => {
    const { nodes } = group(graph, ["a", "b"]);
    const frame = nodes[0]!;

    expect(frame.id).toBe("frame-1");
    expect(frame.type).toBe("group");
    expect(frame.position).toEqual({
      x: 100 - GROUP_PAD,
      y: 100 - GROUP_PAD,
    });
    // 400 + 200 wide − 100 left, plus padding on both sides.
    expect(frame.width).toBe(500 + GROUP_PAD * 2);
    expect(frame.height).toBe(260 + GROUP_PAD * 2);
    // The frame paints behind what it holds, so it comes first.
    expect(nodes.map((n) => n.id)).toEqual(["frame-1", "a", "b", "c"]);
  });

  // The round trip is the whole safety property: grouping is only ever a
  // change of coordinate space, never a move.
  it("round-trips group → ungroup back to the original absolute positions", () => {
    const { nodes: grouped } = group(graph, ["a", "b"]);

    expect(grouped.find((n) => n.id === "a")).toMatchObject({
      parentId: "frame-1",
      extent: "parent",
      position: { x: GROUP_PAD, y: GROUP_PAD },
    });
    expect(withAbsolutePositions(grouped).find((n) => n.id === "a")?.position)
      .toEqual({ x: 100, y: 100 });

    const freed = ungroupFrames(grouped, new Set(["frame-1"]));

    expect(freed.map((n) => n.id).sort()).toEqual(["a", "b", "c"]);
    for (const original of graph) {
      const after = freed.find((n) => n.id === original.id)!;
      expect(after.position).toEqual(original.position);
      expect(after).not.toHaveProperty("parentId");
      expect(after).not.toHaveProperty("extent");
    }
  });

  it("refuses a selection that spans two parents, a frame, or nothing", () => {
    const { nodes: grouped } = group(graph, ["a", "b"]);

    // "a" is framed, "c" is not.
    expect(groupSelection(grouped, new Set(["a", "c"]), { frameId: "f2" }))
      .toMatchObject({ ok: false });
    // Nesting is deliberately out of scope for now.
    expect(groupSelection(grouped, new Set(["frame-1", "c"]), { frameId: "f2" }))
      .toMatchObject({ ok: false });
    expect(groupSelection(graph, new Set([]), { frameId: "f2" })).toMatchObject({
      ok: false,
    });
  });

  it("pads to the grid when the grid is coarser than the default", () => {
    const outcome = groupSelection(graph, new Set(["a"]), {
      frameId: "frame-1",
      gridSize: 64,
    });
    if (!outcome.ok) throw new Error(outcome.reason);

    expect(outcome.nodes[0]!.position).toEqual({ x: 36, y: 36 });
  });

  // A frame deleted on one device while another moves a child inside it: the
  // merge keeps a child whose parent is gone, and ReactFlow errors on that.
  it("drops a parentId that resolves to nothing instead of throwing", () => {
    const orphan: CanvasNode = {
      ...node("a", 20, 20),
      parentId: "frame-gone",
      extent: "parent",
    };

    const reconciled = reconcileFrames([orphan, node("b", 500, 0)]);

    expect(reconciled[0]).not.toHaveProperty("parentId");
    expect(reconciled[0]).not.toHaveProperty("extent");
    expect(reconciled[0]!.position).toEqual({ x: 20, y: 20 });
  });

  it("treats a parent that is not a frame as no parent at all", () => {
    const child: CanvasNode = {
      ...node("a", 10, 10),
      parentId: "b",
      extent: "parent",
    };

    expect(reconcileFrames([child, node("b", 0, 0)])[0]).not.toHaveProperty(
      "parentId",
    );
  });

  it("reads a selected member as a request to ungroup its frame", () => {
    const { nodes } = group(graph, ["a", "b"]);

    expect([...selectedFrameIds(nodes, new Set(["a"]))]).toEqual(["frame-1"]);
    expect([...selectedFrameIds(nodes, new Set(["frame-1"]))]).toEqual([
      "frame-1",
    ]);
    expect(selectedFrameIds(nodes, new Set(["c"])).size).toBe(0);
  });

  it("hands back the same array when there is nothing to flatten", () => {
    // This runs on every drag frame; a copy per frame is the thing to avoid.
    expect(withAbsolutePositions(graph)).toBe(graph);
    expect(sortFramesFirst(graph).map((n) => n.id)).toEqual(["a", "b", "c"]);
  });
});
