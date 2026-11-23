import { describe, expect, it } from "vitest";
import type { RecordedBrowserStep } from "@shared/types/RecordedBrowserStep";
import type { CanvasEdge } from "../types/CanvasEdge";
import type { CanvasGraph } from "../types/CanvasGraph";
import type { CanvasNode } from "../types/CanvasNode";
import type { RecordingPlacement } from "../types/RecordingPlacement";
import { hasGeneratedLabel, placeRecordedStep } from "./recordedSteps";

const placement: RecordingPlacement = { anchorId: "start-1", frameId: "group-rec", frameLabel: "Recording" };

const start: CanvasNode = { id: "start-1", type: "start", position: { x: 100, y: 50 }, data: { label: "Start" } };
const end: CanvasNode = { id: "end-1", type: "end", position: { x: 500, y: 50 }, data: { label: "End" } };
const startToEnd: CanvasEdge = { id: "e-start-end", source: "start-1", target: "end-1", type: "custom" };

const navigate = (id: string): RecordedBrowserStep => ({ stepId: id, config: { action: "navigate", url: "{{env.BASE_URL}}/login" } });
const click = (id: string): RecordedBrowserStep => ({
  stepId: id,
  config: { action: "click", locator: { kind: "role", role: "textbox", name: "Email" } },
});
const fill = (id: string, value: string): RecordedBrowserStep => ({
  stepId: id,
  config: { action: "fill", locator: { kind: "role", role: "textbox", name: "Email" }, value },
});

/** Place `steps` one after another, the way the canvas receives them. */
function record(graph: CanvasGraph, steps: readonly RecordedBrowserStep[]): CanvasGraph {
  const inserted: string[] = [];
  let current = graph;
  for (const step of steps) {
    current = placeRecordedStep(current, step, placement, inserted);
    if (!inserted.includes(step.stepId)) inserted.push(step.stepId);
  }
  return current;
}

const edgePairs = (graph: CanvasGraph): string[] => graph.edges.map((edge) => `${edge.source}->${edge.target}`).sort();

describe("placeRecordedStep", () => {
  it("puts the first step in a new frame below the anchor and splices it into Start → End", () => {
    const graph = record({ nodes: [start, end], edges: [startToEnd] }, [navigate("s1")]);
    expect(graph.nodes.map((node) => node.id)).toEqual(["group-rec", "start-1", "end-1", "s1"]);
    expect(graph.nodes[0]).toMatchObject({ type: "group", position: { x: 100, y: 250 }, data: { label: "Recording" } });
    expect(graph.nodes[3]).toMatchObject({ type: "browser", parentId: "group-rec", extent: "parent", data: { label: "Open /login" } });
    expect(edgePairs(graph)).toEqual(["s1->end-1", "start-1->s1"]);
  });

  it("chains each step after the previous one, and keeps the link to what followed the anchor at the end", () => {
    const graph = record({ nodes: [start, end], edges: [startToEnd] }, [navigate("s1"), click("s2"), fill("s3", "x")]);
    expect(edgePairs(graph)).toEqual(["s1->s2", "s2->s3", "s3->end-1", "start-1->s1"]);
  });

  it("wraps onto a new row after five steps and grows the frame to hold them", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const graph = record({ nodes: [start], edges: [] }, ids.map(navigate));
    const byId = new Map(graph.nodes.map((node) => [node.id, node] as const));
    expect(byId.get("f")?.position.x).toBe(byId.get("a")?.position.x);
    expect(byId.get("f")?.position.y).toBeGreaterThan(byId.get("a")?.position.y ?? 0);
    const frame = byId.get("group-rec");
    expect(frame?.width).toBeGreaterThan(5 * 280);
    expect(frame?.height).toBeGreaterThan(2 * 120);
  });

  it("updates a step in place with a new data object, and renames it when its action changes", () => {
    const first = record({ nodes: [start], edges: [] }, [click("s1")]);
    const before = first.nodes.find((node) => node.id === "s1");
    const after = placeRecordedStep(first, fill("s1", "ada"), placement, ["s1"]).nodes.find((node) => node.id === "s1");
    expect(after?.data).not.toBe(before?.data);
    expect(after?.data).toMatchObject({ label: "Fill Email", config: { action: "fill", value: "ada" } });
  });

  it("updates a step already on the canvas when the list is empty after a renderer reload", () => {
    const first = record({ nodes: [start, end], edges: [startToEnd] }, [navigate("s1"), click("s2")]);
    // A reload loses the store's `placedSteps`; the anchor becomes the last step placed.
    const onLastStep: RecordingPlacement = { anchorId: "s2", frameId: "group-rec", frameLabel: "Recording" };
    const once = placeRecordedStep(first, fill("s2", "a"), onLastStep, []);
    const after = placeRecordedStep(once, fill("s2", "ada"), onLastStep, []);
    expect(after.nodes.filter((node) => node.id === "s2")).toHaveLength(1);
    expect(new Set(after.nodes.map((node) => node.id)).size).toBe(after.nodes.length);
    expect(after.nodes.find((node) => node.id === "s2")).toMatchObject({
      position: first.nodes.find((node) => node.id === "s2")?.position,
      data: { label: "Fill Email", config: { action: "fill", value: "ada" } },
    });
    expect(after.edges.some((edge) => edge.source === edge.target)).toBe(false);
    expect(edgePairs(after)).toEqual(["s1->s2", "s2->end-1", "start-1->s1"]);
  });

  it("still places a new step after the resumed anchor when the list is empty", () => {
    const first = record({ nodes: [start, end], edges: [startToEnd] }, [click("s1")]);
    const after = placeRecordedStep(first, fill("s2", "ada"), { anchorId: "s1", frameId: "group-rec", frameLabel: "Recording" }, []);
    expect(after.nodes.filter((node) => node.id === "s2")).toHaveLength(1);
    expect(edgePairs(after)).toEqual(["s1->s2", "s2->end-1", "start-1->s1"]);
  });

  it("keeps a title the user changed", () => {
    const graph = record({ nodes: [start], edges: [] }, [click("s1")]);
    const renamed = { ...graph, nodes: graph.nodes.map((node) => (node.id === "s1" ? { ...node, data: { ...node.data, label: "Focus email" } } : node)) };
    const after = placeRecordedStep(renamed, fill("s1", "ada"), placement, ["s1"]).nodes.find((node) => node.id === "s1");
    expect(after?.data.label).toBe("Focus email");
  });

  it("refreshes a generated title when the recorder refines the step's locator", () => {
    const vague: RecordedBrowserStep = { stepId: "s1", config: { action: "click", locator: { kind: "css", value: "div", nth: 4 } } };
    const graph = record({ nodes: [start], edges: [] }, [vague]);
    expect(graph.nodes.find((node) => node.id === "s1")?.data.label).toBe("Click");
    const refined: RecordedBrowserStep = { stepId: "s1", config: { action: "click", locator: { kind: "role", role: "button", name: "Continuer" } } };
    const after = placeRecordedStep(graph, refined, placement, ["s1"]).nodes.find((node) => node.id === "s1");
    expect(after?.data.label).toBe("Click Continuer");
  });

  it("keeps the generated title while a fill's text grows, and never puts the text in it", () => {
    const graph = record({ nodes: [start], edges: [] }, [fill("s1", "a"), fill("s1", "ad"), fill("s1", "ada")]);
    expect(graph.nodes.find((node) => node.id === "s1")?.data).toMatchObject({ label: "Fill Email", config: { value: "ada" } });
  });

  it("follows the config for a title carrying only the action's own words", () => {
    // A step saved before titles named their target: "Type into a field" is generated, not the user's.
    const graph = record({ nodes: [start], edges: [] }, [fill("s1", "a")]);
    const earlier = { ...graph, nodes: graph.nodes.map((node) => (node.id === "s1" ? { ...node, data: { ...node.data, label: "Type into a field" } } : node)) };
    const after = placeRecordedStep(earlier, fill("s1", "ada"), placement, ["s1"]).nodes.find((node) => node.id === "s1");
    expect(after?.data.label).toBe("Fill Email");
  });

  it("follows the config for an older title once the recorder names the target", () => {
    const bare: RecordedBrowserStep = { stepId: "s1", config: { action: "click", locator: { kind: "css", value: "div" } } };
    const graph = record({ nodes: [start], edges: [] }, [bare]);
    expect(graph.nodes.find((node) => node.id === "s1")?.data.label).toBe("Click");
    const refined: RecordedBrowserStep = { stepId: "s1", config: { action: "click", locator: { kind: "role", role: "button", name: "Continuer" } } };
    const after = placeRecordedStep(graph, refined, placement, ["s1"]).nodes.find((node) => node.id === "s1");
    expect(after?.data.label).toBe("Click Continuer");
  });

  it("does not put back a step the user deleted, and connects the next one to the last step still there", () => {
    const graph = record({ nodes: [start], edges: [] }, [navigate("s1"), click("s2")]);
    const without = {
      nodes: graph.nodes.filter((node) => node.id !== "s2"),
      edges: graph.edges.filter((edge) => edge.target !== "s2" && edge.source !== "s2"),
    };
    const updated = placeRecordedStep(without, fill("s2", "ada"), placement, ["s1", "s2"]);
    expect(updated.nodes.some((node) => node.id === "s2")).toBe(false);
    const next = placeRecordedStep(updated, navigate("s3"), placement, ["s1", "s2"]);
    expect(edgePairs(next)).toEqual(["s1->s3", "start-1->s1"]);
  });

  it("gives a workflow with no End one, right of the frame, so it ends Start → steps → End", () => {
    const graph = record({ nodes: [start], edges: [] }, [navigate("s1"), click("s2")]);
    const ends = graph.nodes.filter((node) => node.type === "end");
    expect(ends).toHaveLength(1);
    const end = ends[0];
    const frame = graph.nodes.find((node) => node.id === "group-rec");
    expect(end?.parentId).toBeUndefined();
    // Right of the frame even once it is five steps wide, level with its first row.
    expect(end?.position.x).toBeGreaterThan((frame?.position.x ?? 0) + 5 * 300);
    expect(end?.position.y).toBeGreaterThan(frame?.position.y ?? 0);
    expect(edgePairs(graph)).toEqual(["s1->s2", `s2->${end?.id}`, "start-1->s1"]);
  });

  it("adds no End when the workflow has one, or when the anchor already leads somewhere", () => {
    const withEnd = record({ nodes: [start, end], edges: [startToEnd] }, [navigate("s1")]);
    expect(withEnd.nodes.filter((node) => node.type === "end").map((node) => node.id)).toEqual(["end-1"]);

    const http: CanvasNode = { id: "http", type: "http-request", position: { x: 400, y: 50 }, data: {} };
    const toHttp: CanvasEdge = { id: "e-start-http", source: "start-1", target: "http", type: "custom" };
    const midway = record({ nodes: [start, http], edges: [toHttp] }, [navigate("s1")]);
    expect(midway.nodes.some((node) => node.type === "end")).toBe(false);
    expect(edgePairs(midway)).toEqual(["s1->http", "start-1->s1"]);
  });

  it("puts steps into an existing frame on cells its other steps leave free, and keeps its label", () => {
    const frame: CanvasNode = { id: "group-rec", type: "group", position: { x: 0, y: 300 }, width: 400, height: 200, data: { label: "Checkout", config: {} } };
    const kept = (id: string, x: number): CanvasNode => ({ id, type: "browser", position: { x, y: 64 }, parentId: "group-rec", extent: "parent", data: { label: id } });
    // Cell 1 was the replaced step's; cell 2 holds a step that stays.
    const graph = record({ nodes: [frame, start, end, kept("first", 28), kept("third", 668)], edges: [startToEnd] }, [navigate("n1"), click("n2")]);
    const byId = new Map(graph.nodes.map((node) => [node.id, node] as const));
    expect(graph.nodes.filter((node) => node.type === "group")).toHaveLength(1);
    expect(byId.get("group-rec")?.data.label).toBe("Checkout");
    expect(byId.get("n1")?.position).toEqual({ x: 348, y: 64 });
    expect(byId.get("n2")?.position).toEqual({ x: 988, y: 64 });
    expect(byId.get("third")?.position).toEqual({ x: 668, y: 64 });
    // Grown to hold four cells, never shrunk below the size it had.
    expect(byId.get("group-rec")?.width).toBeGreaterThanOrEqual(4 * 300);
    expect(byId.get("group-rec")?.height).toBeGreaterThanOrEqual(200);
  });

  it("leaves a branching anchor's edges alone and adds one more", () => {
    const branch: CanvasEdge = { id: "e-start-other", source: "start-1", target: "other", type: "custom" };
    const other: CanvasNode = { id: "other", type: "end", position: { x: 0, y: 0 }, data: {} };
    const graph = record({ nodes: [start, end, other], edges: [startToEnd, branch] }, [navigate("s1")]);
    expect(edgePairs(graph)).toEqual(["start-1->end-1", "start-1->other", "start-1->s1"]);
  });

  it("does not splice an anchor whose one edge leaves from a named handle", () => {
    const pass: CanvasEdge = { id: "e-pass", source: "start-1", sourceHandle: "pass", target: "end-1", type: "custom" };
    const graph = record({ nodes: [start, end], edges: [pass] }, [navigate("s1")]);
    expect(edgePairs(graph)).toEqual(["start-1->end-1", "start-1->s1"]);
  });
});

describe("hasGeneratedLabel", () => {
  const config = { action: "fill", locator: { kind: "role", role: "textbox", name: "Email" } };

  it("accepts an empty title, the title the recorder writes now, and the one it wrote before targets were named", () => {
    expect(hasGeneratedLabel(undefined, config)).toBe(true);
    expect(hasGeneratedLabel("", config)).toBe(true);
    expect(hasGeneratedLabel("Fill Email", config)).toBe(true);
    expect(hasGeneratedLabel("Type into a field", config)).toBe(true);
    expect(hasGeneratedLabel("Click", { action: "click" })).toBe(true);
    expect(hasGeneratedLabel("Browser step", {})).toBe(true);
  });

  it("refuses a title the user typed", () => {
    expect(hasGeneratedLabel("Focus email", config)).toBe(false);
    expect(hasGeneratedLabel("Type", config)).toBe(false);
    expect(hasGeneratedLabel("Open /login", config)).toBe(false);
  });
});
