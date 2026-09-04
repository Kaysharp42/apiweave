import { describe, it, expect } from "vitest";
import { Position, getBezierPath } from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";
import { autoLayout, autoLayoutRootNodes } from "./autoLayout";

/**
 * Bezier edges through a dagre layout.
 *
 * The layout was tuned when edges were orthogonal steps, which hug the rank
 * corridors. A bezier bulges out of its corridor, so an edge spanning distant
 * ranks can pass *under* an intermediate node — the curve is drawn behind the
 * node, so it reads as an edge that vanishes and reappears.
 *
 * This samples every edge's curve and asserts no sample lands inside a node it
 * does not connect. If this fails the fix is a `ranksep` bump in `autoLayout`,
 * not a return to step paths.
 */

const NODE_W = 280;
const NODE_H = 96;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Parse `M x,y C c1 c2 end` — the exact shape getBezierPath returns. */
function parseCubic(path: string): number[] {
  const numbers = path.match(/-?\d+(\.\d+)?/g);
  if (numbers === null) throw new Error(`unparseable path: ${path}`);
  return numbers.map(Number);
}

function cubicPointAt(p: number[], t: number): { x: number; y: number } {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = p as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * x0 + b * x1 + c * x2 + d * x3,
    y: a * y0 + b * y1 + c * y2 + d * y3,
  };
}

/** Inset so an edge merely grazing a node's border is not counted as a hit. */
function contains(rect: Rect, x: number, y: number, inset = 6): boolean {
  return (
    x > rect.x + inset &&
    x < rect.x + rect.width - inset &&
    y > rect.y + inset &&
    y < rect.y + rect.height - inset
  );
}

/**
 * A branching graph of `count` nodes: a spine with branches that rejoin, which
 * is what produces the multi-rank edges most likely to cut under a node.
 */
function buildGraph(count: number): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    type: "http-request",
    position: { x: 0, y: 0 },
    data: {},
    width: NODE_W,
    height: NODE_H,
  }));

  const edges: Edge[] = [];
  for (let i = 1; i < count; i++) {
    edges.push({ id: `e${i}`, source: `n${i - 1}`, target: `n${i}` });
  }
  // Branches that skip ranks — the stress case for a curved path.
  for (let i = 0; i + 3 < count; i += 4) {
    edges.push({ id: `skip${i}`, source: `n${i}`, target: `n${i + 3}` });
  }
  return { nodes, edges };
}

function rectFor(node: Node): Rect {
  return {
    x: node.position.x,
    y: node.position.y,
    width: NODE_W,
    height: NODE_H,
  };
}

/**
 * The first node the curve passes under, ignoring the two it connects.
 * Samples 61 points along the curve; returns as soon as one lands inside.
 */
function nodeUnderCurve(
  cubic: number[],
  laidOut: Node[],
  edge: Edge,
): string | undefined {
  const others = laidOut.filter(
    (node) => node.id !== edge.source && node.id !== edge.target,
  );

  for (let step = 0; step <= 60; step++) {
    const { x, y } = cubicPointAt(cubic, step / 60);
    const hit = others.find((node) => contains(rectFor(node), x, y));
    if (hit) return hit.id;
  }

  return undefined;
}

function edgesCuttingUnderNodes(count: number): string[] {
  const { nodes, edges } = buildGraph(count);
  const laidOut = autoLayout(nodes, edges);

  const byId = new Map(laidOut.map((n) => [n.id, n]));
  const offenders: string[] = [];

  for (const edge of edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) continue;

    const [path] = getBezierPath({
      // LR layout: edges leave the right side and arrive on the left.
      sourceX: source.position.x + NODE_W,
      sourceY: source.position.y + NODE_H / 2,
      sourcePosition: Position.Right,
      targetX: target.position.x,
      targetY: target.position.y + NODE_H / 2,
      targetPosition: Position.Left,
    });

    const hit = nodeUnderCurve(parseCubic(path), laidOut, edge);
    if (hit) offenders.push(`${edge.id} passes under ${hit}`);
  }

  return offenders;
}

describe("autoLayout with bezier edges", () => {
  it("keeps every edge clear of unrelated nodes at 8 nodes", () => {
    expect(edgesCuttingUnderNodes(8)).toEqual([]);
  });

  it("keeps every edge clear of unrelated nodes at 30 nodes", () => {
    expect(edgesCuttingUnderNodes(30)).toEqual([]);
  });

  it("detects a node sitting on a curve, so the checks above can fail", () => {
    // Without this, a sampler bug would make the two assertions above pass
    // vacuously. A straight left-to-right edge with a node parked on top of it
    // must be reported.
    const [path] = getBezierPath({
      sourceX: 0,
      sourceY: 0,
      sourcePosition: Position.Right,
      targetX: 600,
      targetY: 0,
      targetPosition: Position.Left,
    });
    const cubic = parseCubic(path);
    const blocker: Rect = {
      x: 250,
      y: -NODE_H / 2,
      width: NODE_W,
      height: NODE_H,
    };

    const hit = Array.from({ length: 61 }, (_, step) =>
      cubicPointAt(cubic, step / 60),
    ).some(({ x, y }) => contains(blocker, x, y));

    expect(hit).toBe(true);
  });

  it("lays out left to right with nodes in rank order", () => {
    const { nodes, edges } = buildGraph(8);
    const laidOut = autoLayout(nodes, edges);
    const first = laidOut.find((n) => n.id === "n0");
    const last = laidOut.find((n) => n.id === "n7");
    expect(first?.position.x).toBeLessThan(last?.position.x ?? 0);
  });

  // Since React Flow v12 a measured node carries its size on `node.measured`,
  // and `node.width` is undefined for every node this app creates. Reading only
  // `width` lays the whole graph out at the fallback size and overlaps real
  // nodes, so the two spellings have to produce the same layout.
  it("spaces measured nodes the same as explicitly sized ones", () => {
    const { nodes, edges } = buildGraph(6);
    const measured = nodes.map(({ width, height, ...rest }) => ({
      ...rest,
      measured: { width, height },
    })) as Node[];

    expect(autoLayout(measured, edges).map((n) => n.position)).toEqual(
      autoLayout(nodes, edges).map((n) => n.position),
    );
  });
  // #4: dagre lays out a flat graph, and a framed node's position is relative
  // to its frame. Excluding frames instead left them parked where they were
  // while the freed chain fragments were laid out from the origin, straight
  // over the top of them.
  describe("with a frame", () => {
    /** A 6-node chain with n2 and n3 framed, both parked overlapping at 0,0. */
    function framedChain() {
      const { nodes, edges } = buildGraph(6);
      const members = new Set(["n2", "n3"]);
      const framed = [
        {
          id: "frame-1",
          type: "group",
          position: { x: -50, y: -50 },
          width: 400,
          height: 300,
          data: {},
        },
        ...nodes.map((node) =>
          members.has(node.id)
            ? { ...node, parentId: "frame-1", position: { x: 0, y: 0 } }
            : node,
        ),
      ] as Node[];
      return { framed, edges };
    }

    function frameRect(laidOut: Node[]): Rect {
      const frame = laidOut.find((node) => node.id === "frame-1");
      if (frame === undefined) throw new Error("frame missing from layout");
      return {
        x: frame.position.x,
        y: frame.position.y,
        width: frame.width ?? 0,
        height: frame.height ?? 0,
      };
    }

    function overlaps(a: Rect, b: Rect): boolean {
      return (
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y
      );
    }

    it("tidies members inside the frame's own coordinate space", () => {
      const { framed, edges } = framedChain();
      const laidOut = autoLayoutRootNodes(framed, edges);
      const byId = new Map(laidOut.map((node) => [node.id, node]));
      const n2 = byId.get("n2");
      const n3 = byId.get("n3");

      // n2 -> n3, so the edge orders them left to right, and neither is left
      // sitting on top of the other.
      expect(n2?.position.x).toBeLessThan(n3?.position.x ?? 0);
      expect(overlaps(rectFor(n2 as Node), rectFor(n3 as Node))).toBe(false);
      // Still frame-relative: a member laid out in absolute canvas coordinates
      // would render an unpredictable distance outside its frame.
      expect(n2?.parentId).toBe("frame-1");
      expect(n2?.position.x).toBeGreaterThanOrEqual(0);
      expect(n2?.position.y).toBeGreaterThanOrEqual(0);
    });

    it("refits the frame around what it holds", () => {
      const { framed, edges } = framedChain();
      const laidOut = autoLayoutRootNodes(framed, edges);
      const rect = frameRect(laidOut);

      // Every member fits, with room to spare on all four sides.
      for (const member of laidOut.filter((n) => n.parentId === "frame-1")) {
        expect(member.position.x).toBeGreaterThan(0);
        expect(member.position.y).toBeGreaterThan(0);
        expect(member.position.x + NODE_W).toBeLessThan(rect.width);
        expect(member.position.y + NODE_H).toBeLessThan(rect.height);
      }
      // Two 280px nodes side by side no longer fit the original 400px box.
      expect(rect.width).toBeGreaterThan(400);
    });

    it("lays the frame out clear of every other node", () => {
      const { framed, edges } = framedChain();
      const laidOut = autoLayoutRootNodes(framed, edges);
      const rect = frameRect(laidOut);

      const colliding = laidOut
        .filter((node) => node.id !== "frame-1" && node.parentId === undefined)
        .filter((node) => overlaps(rectFor(node), rect))
        .map((node) => node.id);

      expect(colliding).toEqual([]);
    });

    it("keeps the chain's order through the frame", () => {
      const { framed, edges } = framedChain();
      const laidOut = autoLayoutRootNodes(framed, edges);
      const x = (id: string) =>
        laidOut.find((node) => node.id === id)?.position.x ?? NaN;

      // n1 -> n2 and n3 -> n4 collapse to n1 -> frame -> n4, so the frame has
      // to sit between them. Dropping those edges is what let the freed
      // fragments pile up at the origin.
      expect(x("n1")).toBeLessThan(x("frame-1"));
      expect(x("frame-1")).toBeLessThan(x("n4"));
    });

    it("leaves notes where the user put them", () => {
      const { nodes, edges } = buildGraph(4);
      const withNote = [
        ...nodes,
        { id: "note-1", type: "note", position: { x: 999, y: 999 }, data: {} },
      ] as Node[];

      const laidOut = autoLayoutRootNodes(withNote, edges);
      expect(laidOut.find((node) => node.id === "note-1")?.position).toEqual({
        x: 999,
        y: 999,
      });
    });

    it("grows the frame to cover a note it holds rather than clipping it", () => {
      const { framed, edges } = framedChain();
      const withNote = [
        ...framed,
        {
          id: "note-1",
          type: "note",
          parentId: "frame-1",
          position: { x: 40, y: 800 },
          width: 200,
          height: 120,
          data: {},
        },
      ] as Node[];

      const laidOut = autoLayoutRootNodes(withNote, edges);
      const note = laidOut.find((node) => node.id === "note-1");

      expect(note?.position).toEqual({ x: 40, y: 800 });
      expect(frameRect(laidOut).height).toBeGreaterThan(920);
    });
  });
});
