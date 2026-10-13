import { describe, expect, it } from "vitest";
import { copyNodes, pasteNodes, PASTE_OFFSET } from "./canvasClipboard";
import type { CanvasEdge } from "../types/CanvasEdge";
import type { CanvasNode } from "../types/CanvasNode";

const node = (
  id: string,
  x: number,
  extra: Partial<CanvasNode> = {},
): CanvasNode => ({
  id,
  type: "http-request",
  position: { x, y: 0 },
  data: { label: id, config: { url: `https://example.test/${id}` } },
  ...extra,
});
const edge = (source: string, target: string): CanvasEdge => ({
  id: `${source}->${target}`,
  source,
  target,
  sourceHandle: "out",
});

const nodes: CanvasNode[] = [
  node("frame", 100, { type: "group" }),
  node("a", 10, { parentId: "frame", extent: "parent" }),
  node("b", 200, { parentId: "frame", extent: "parent" }),
  node("c", 500),
  node("d", 800),
];
const edges = [edge("a", "b"), edge("b", "c"), edge("c", "d")];

describe("canvas clipboard", () => {
  it("copies every selected node and only the edges inside the selection", () => {
    const clipboard = copyNodes(nodes, edges, new Set(["c", "d"]));

    expect(clipboard.nodes.map((n) => n.id)).toEqual(["c", "d"]);
    expect(clipboard.edges.map((e) => e.id)).toEqual(["c->d"]);
  });

  it("pastes with new ids, an offset, and the internal edges rewired", () => {
    const pasted = pasteNodes(copyNodes(nodes, edges, new Set(["c", "d"])), 7);

    expect(pasted.nodes.map((n) => n.id)).toEqual([
      "http-request-7-0",
      "http-request-7-1",
    ]);
    expect(pasted.nodes[0]?.position).toEqual({ x: 500 + PASTE_OFFSET, y: PASTE_OFFSET });
    expect(pasted.nodes.every((n) => n.selected === true)).toBe(true);
    expect(pasted.edges).toEqual([
      expect.objectContaining({
        source: "http-request-7-0",
        target: "http-request-7-1",
        sourceHandle: "out",
      }),
    ]);
    expect(pasted.edges[0]?.id).not.toBe("c->d");
  });

  it("copies a frame with its children and re-parents them on paste", () => {
    const clipboard = copyNodes(nodes, edges, new Set(["frame"]));
    expect(clipboard.nodes.map((n) => n.id)).toEqual(["frame", "a", "b"]);
    expect(clipboard.edges.map((e) => e.id)).toEqual(["a->b"]);

    const pasted = pasteNodes(clipboard, 9);
    const frame = pasted.nodes[0]!;
    expect(frame.type).toBe("group");
    // Children keep their frame-relative position and follow the new frame.
    expect(pasted.nodes.slice(1).map((n) => [n.parentId, n.position.x])).toEqual([
      [frame.id, 10],
      [frame.id, 200],
    ]);
  });

  it("frees a child copied without its frame, at its canvas position", () => {
    const clipboard = copyNodes(nodes, edges, new Set(["b"]));

    expect(clipboard.nodes).toHaveLength(1);
    expect(clipboard.nodes[0]?.parentId).toBeUndefined();
    expect(clipboard.nodes[0]?.extent).toBeUndefined();
    expect(clipboard.nodes[0]?.position).toEqual({ x: 300, y: 0 });
  });

  it("copies deeply, so editing the original leaves the clipboard alone", () => {
    const clipboard = copyNodes(nodes, edges, new Set(["c"]));
    (nodes[3]!.data.config as { url: string }).url = "changed";
    expect((clipboard.nodes[0]?.data.config as { url: string }).url).toBe(
      "https://example.test/c",
    );
  });
});
