import { describe, expect, it } from "vitest";
import type { CanvasEdge } from "../types/CanvasEdge";
import type { CanvasGraph } from "../types/CanvasGraph";
import type { CanvasNode } from "../types/CanvasNode";
import { canRecordAfter, canRepick, canRerecordFrom, removeStepsFrom } from "./stepReplay";

const node = (id: string, type: string, config: Record<string, unknown> = {}, parentId?: string): CanvasNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  ...(parentId === undefined ? {} : { parentId, extent: "parent" as const }),
  data: { label: id, config },
});
const open = (id: string, parentId?: string): CanvasNode => node(id, "browser", { action: "navigate", url: "https://dev.test/" }, parentId);
const click = (id: string, parentId?: string): CanvasNode =>
  node(id, "browser", { action: "click", locator: { kind: "role", role: "button", name: id } }, parentId);
const edge = (source: string, target: string, sourceHandle?: string): CanvasEdge => ({
  id: `${source}-${target}`,
  source,
  target,
  ...(sourceHandle === undefined ? {} : { sourceHandle }),
});

/** Start → open → a → b → api → c → End, the browser steps in one frame. */
function workflow(): CanvasGraph {
  return {
    nodes: [
      node("frame", "group"),
      node("start", "start"),
      open("open", "frame"),
      click("a", "frame"),
      click("b", "frame"),
      node("api", "http-request"),
      click("c"),
      node("end", "end"),
    ],
    edges: [edge("start", "open"), edge("open", "a"), edge("a", "b"), edge("b", "api"), edge("api", "c"), edge("c", "end")],
  };
}

describe("canRepick", () => {
  it.each([
    ["a click after a page is opened", "a", true],
    ["a click after an HTTP step, with a page opened earlier", "c", true],
    ["the step that opens the page", "open", false],
    ["an HTTP step", "api", false],
  ])("%s → %s", (_what, nodeId, expected) => {
    expect(canRepick(workflow(), nodeId)).toBe(expected);
  });

  it("is not offered when nothing before the step opens a page", () => {
    const graph: CanvasGraph = { nodes: [node("start", "start"), click("a")], edges: [edge("start", "a")] };
    expect(canRepick(graph, "a")).toBe(false);
  });

  it("is not offered when the rest of the step is invalid, since main would refuse the re-pick", () => {
    const graph = workflow();
    const invalid: CanvasGraph = {
      ...graph,
      nodes: graph.nodes.map((candidate) =>
        candidate.id === "a"
          ? { ...candidate, data: { ...candidate.data, config: { action: "click", locator: { kind: "role", role: "button", name: "a" }, button: "diagonal" } } }
          : candidate,
      ),
    };
    expect(canRepick(invalid, "a")).toBe(false);
  });
});

describe("canRerecordFrom", () => {
  it.each([
    ["a step in a straight line", "a", true],
    ["a step after an HTTP step", "c", true],
    ["the first browser step: nothing opens a page before it", "open", false],
  ])("%s → %s", (_what, nodeId, expected) => {
    expect(canRerecordFrom(workflow(), nodeId)).toBe(expected);
  });

  it("is not offered where the new steps could not take the step's place", () => {
    const branch = workflow();
    // Reached from a condition's handle, or from a step that also leads elsewhere.
    expect(canRerecordFrom({ ...branch, edges: branch.edges.map((e) => (e.id === "open-a" ? edge("open", "a", "true") : e)) }, "a")).toBe(false);
    expect(canRerecordFrom({ ...branch, edges: [...branch.edges, edge("open", "api")] }, "a")).toBe(false);
    // Merged into from two places, or branching out itself.
    expect(canRerecordFrom({ ...branch, edges: [...branch.edges, edge("start", "a")] }, "a")).toBe(false);
    expect(canRerecordFrom({ ...branch, edges: [...branch.edges, edge("a", "end")] }, "a")).toBe(false);
  });
});

describe("canRecordAfter", () => {
  it.each([
    ["the step that opens the page: it runs in the replay", "open", true],
    ["a step in the middle of a chain", "a", true],
    ["an HTTP step after a page is opened", "api", true],
    ["the last step before End", "c", true],
    ["Start", "start", false],
    ["End", "end", false],
    ["a frame", "frame", false],
  ])("%s → %s", (_what, nodeId, expected) => {
    expect(canRecordAfter(workflow(), nodeId)).toBe(expected);
  });

  it("is offered on a last step with nothing after it", () => {
    const graph = workflow();
    expect(canRecordAfter({ ...graph, edges: graph.edges.filter((e) => e.id !== "c-end") }, "c")).toBe(true);
  });

  it("is not offered before any browser step has opened a page", () => {
    const graph: CanvasGraph = { nodes: [node("start", "start"), node("api", "http-request"), open("open")], edges: [edge("start", "api"), edge("api", "open")] };
    expect(canRecordAfter(graph, "api")).toBe(false);
  });

  it("is not offered where the new steps would become a parallel branch", () => {
    const graph = workflow();
    // Two ways out, or one from a handle.
    expect(canRecordAfter({ ...graph, edges: [...graph.edges, edge("a", "end")] }, "a")).toBe(false);
    expect(canRecordAfter({ ...graph, edges: graph.edges.map((e) => (e.id === "a-b" ? edge("a", "b", "pass") : e)) }, "a")).toBe(false);
  });
});

describe("removeStepsFrom", () => {
  it("takes out the step and the browser steps after it up to another kind of step, and joins the gap", () => {
    const result = removeStepsFrom(workflow(), "a");
    expect(result?.anchorId).toBe("open");
    expect(result?.graph.nodes.map((n) => n.id)).toEqual(["frame", "start", "open", "api", "c", "end"]);
    expect(result?.graph.edges.map((e) => [e.source, e.target])).toEqual([
      ["start", "open"],
      ["api", "c"],
      ["c", "end"],
      ["open", "api"],
    ]);
  });

  it("returns the frame the step was in, for the new steps to go back into", () => {
    expect(removeStepsFrom(workflow(), "a")?.frameId).toBe("frame");
    expect(removeStepsFrom(workflow(), "c")?.frameId).toBeNull();
  });

  it("keeps the step's own frame even when it empties it, and takes out another frame it leaves empty", () => {
    const graph: CanvasGraph = {
      nodes: [
        node("start", "start"),
        open("open"),
        node("frame", "group"),
        node("later", "group"),
        click("a", "frame"),
        click("b", "frame"),
        click("c", "later"),
        node("end", "end"),
      ],
      edges: [edge("start", "open"), edge("open", "a"), edge("a", "b"), edge("b", "c"), edge("c", "end")],
    };
    const result = removeStepsFrom(graph, "a");
    expect(result?.frameId).toBe("frame");
    expect(result?.graph.nodes.map((n) => n.id)).toEqual(["start", "open", "frame", "end"]);
    expect(result?.graph.edges.map((e) => [e.source, e.target])).toEqual([["start", "open"], ["open", "end"]]);
  });

  it("returns no frame when the step's frame is not on the canvas", () => {
    const graph: CanvasGraph = {
      nodes: [node("start", "start"), open("open"), click("a", "gone"), node("end", "end")],
      edges: [edge("start", "open"), edge("open", "a"), edge("a", "end")],
    };
    expect(removeStepsFrom(graph, "a")?.frameId).toBeNull();
  });

  it("stops before a step two paths lead into, and leaves a last step with nothing after it unjoined", () => {
    const merged = workflow();
    merged.edges.push(edge("start", "b"));
    // `b` has two ways in, so it is not part of `a`'s straight line: only `a` goes, and `open` leads to `b`.
    const result1 = removeStepsFrom(merged, "a");
    expect(result1?.graph.nodes.map((n) => n.id)).toContain("b");
    expect(result1?.graph.edges.map((e) => [e.source, e.target])).toEqual(expect.arrayContaining([["open", "b"], ["start", "b"], ["b", "api"]]));
    expect(result1?.graph.nodes.map((n) => n.id)).not.toContain("a");

    const tail: CanvasGraph = { nodes: [node("start", "start"), open("open"), click("a")], edges: [edge("start", "open"), edge("open", "a")] };
    const result = removeStepsFrom(tail, "a");
    expect(result?.graph.edges.map((e) => [e.source, e.target])).toEqual([["start", "open"]]);
    expect(result?.anchorId).toBe("open");
  });
});
