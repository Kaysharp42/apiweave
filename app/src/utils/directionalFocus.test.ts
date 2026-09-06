import { describe, it, expect } from "vitest";
import type { Node } from "@xyflow/react";
import { nearestInDirection } from "./directionalFocus";

/** Same footprint for every node, so the fixture's numbers are its centres. */
const at = (id: string, x: number, y: number): Node => ({
  id,
  position: { x, y },
  data: {},
  measured: { width: 100, height: 100 },
});

//   b
//   |
//   a — c ————————— d
//                   (d is also far below c)
const layout = [
  at("a", 0, 0),
  at("b", 0, -300),
  at("c", 400, 0),
  at("d", 2000, 1200),
];

describe("nearestInDirection", () => {
  it("moves along the axis", () => {
    expect(nearestInDirection(layout, "a", "right")).toBe("c");
    expect(nearestInDirection(layout, "c", "left")).toBe("a");
    expect(nearestInDirection(layout, "a", "up")).toBe("b");
    expect(nearestInDirection(layout, "b", "down")).toBe("a");
  });

  it("stops at the edge of the graph", () => {
    expect(nearestInDirection(layout, "b", "up")).toBeNull();
    expect(nearestInDirection(layout, "a", "left")).toBeNull();
  });

  // The case the perpendicular weighting exists for: from `c`, `d` is the only
  // other node to the right, but from `a` the nearer-on-axis `c` must win over
  // the far-right, far-below `d`.
  it("prefers a node on the axis over a nearer one off it", () => {
    const spread = [at("a", 0, 0), at("near", 600, 900), at("axis", 900, 0)];
    expect(nearestInDirection(spread, "a", "right")).toBe("axis");
  });

  it("ignores nodes level with the origin", () => {
    const level = [at("a", 0, 0), at("same-column", 0, 500)];
    expect(nearestInDirection(level, "a", "right")).toBeNull();
    expect(nearestInDirection(level, "a", "down")).toBe("same-column");
  });

  // Left-most wins, and top-most breaks a tie on the same column — `a` and `b`
  // share x, so it is `b`. Direction is deliberately ignored: the press has to
  // land somewhere or the canvas stays mouse-only.
  it("enters the graph at the left-most node when nothing is focused", () => {
    expect(nearestInDirection(layout, null, "right")).toBe("b");
    expect(nearestInDirection(layout, "gone", "up")).toBe("b");
    expect(nearestInDirection([at("only", 900, 0), at("start", 0, 0)], null, "left")).toBe("start");
    expect(nearestInDirection([], null, "right")).toBeNull();
  });
});
