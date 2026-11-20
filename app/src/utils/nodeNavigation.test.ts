import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import {
  isEditableNode,
  nextNodeSteps,
  previousNodeSteps,
  previousStepsFor,
  trailAfterStep,
} from "./nodeNavigation";
import type { WorkflowCanvasNodeData } from "../types/WorkflowCanvasNodeData";

function node(
  id: string,
  type = "http-request",
  data: WorkflowCanvasNodeData = { label: id.toUpperCase() },
): Node<WorkflowCanvasNodeData> {
  return { id, type, position: { x: 0, y: 0 }, data };
}

function edge(source: string, target: string, sourceHandle: string | null = null): Edge {
  return { id: `${source}-${target}`, source, target, sourceHandle };
}

const ids = (steps: readonly { nodeId: string }[]) => steps.map((step) => step.nodeId);

describe("nextNodeSteps / previousNodeSteps", () => {
  it("walks a straight line one edge at a time", () => {
    const nodes = [node("a"), node("b"), node("c")];
    const edges = [edge("a", "b"), edge("b", "c")];

    expect(ids(nextNodeSteps(nodes, edges, "b"))).toEqual(["c"]);
    expect(ids(previousNodeSteps(nodes, edges, "b"))).toEqual(["a"]);
    expect(nextNodeSteps(nodes, edges, "c")).toEqual([]);
  });

  it("lists an assertion's branches pass first, whatever order they were drawn in", () => {
    const nodes = [node("assert", "assertion"), node("ok"), node("bad")];
    const edges = [edge("assert", "bad", "fail"), edge("assert", "ok", "pass")];

    const steps = nextNodeSteps(nodes, edges, "assert");
    expect(steps.map((step) => [step.nodeId, step.handle])).toEqual([
      ["ok", "pass"],
      ["bad", "fail"],
    ]);
  });

  it("keeps a parallel fan-out in the order its edges were drawn", () => {
    const nodes = [node("a"), node("x"), node("y"), node("z")];
    const edges = [edge("a", "y"), edge("a", "x"), edge("a", "z")];

    expect(ids(nextNodeSteps(nodes, edges, "a"))).toEqual(["y", "x", "z"]);
  });

  it("offers every parent of a merge", () => {
    const nodes = [node("b"), node("c"), node("m", "merge")];
    const edges = [edge("b", "m"), edge("c", "m")];

    expect(ids(previousNodeSteps(nodes, edges, "m"))).toEqual(["b", "c"]);
  });

  it("stops at start and end rather than stepping onto them", () => {
    const nodes = [node("s", "start"), node("a"), node("e", "end")];
    const edges = [edge("s", "a"), edge("a", "e")];

    expect(previousNodeSteps(nodes, edges, "a")).toEqual([]);
    expect(nextNodeSteps(nodes, edges, "a")).toEqual([]);
  });

  it("ignores dangling edges, self-loops and duplicate edges", () => {
    const nodes = [node("a"), node("b")];
    const edges = [edge("a", "gone"), edge("a", "a"), edge("a", "b"), { ...edge("a", "b"), id: "dup" }];

    expect(ids(nextNodeSteps(nodes, edges, "a"))).toEqual(["b"]);
  });

  it("stays finite on a cycle", () => {
    const nodes = [node("a"), node("b")];
    const edges = [edge("a", "b"), edge("b", "a")];

    expect(ids(nextNodeSteps(nodes, edges, "b"))).toEqual(["a"]);
    expect(ids(previousNodeSteps(nodes, edges, "a"))).toEqual(["b"]);
  });

  it("marks the branch the last run took and falls back to the type for a blank label", () => {
    const nodes = [
      node("assert", "assertion"),
      node("ok", "http-request", { label: "  ", executionTimestamp: 5 }),
      node("bad", "delay", {}),
    ];
    const edges = [edge("assert", "ok", "pass"), edge("assert", "bad", "fail")];

    const [ok, bad] = nextNodeSteps(nodes, edges, "assert");
    expect(ok?.ranLastRun).toBe(true);
    expect(ok?.label).toBe("HTTP Request");
    expect(bad?.ranLastRun).toBe(false);
  });
});

describe("a step's detail line", () => {
  // Recorded browser steps are mostly all called "Click": the detail is what
  // tells the neighbours apart in the tooltip and the branch picker.
  it("says what a browser step acts on, and what a request calls", () => {
    const nodes = [
      node("a"),
      node("save", "browser", {
        label: "Click",
        config: { action: "click", locator: { kind: "role", role: "button", name: "Save" } },
      }),
      node("get", "http-request", { label: "Get", config: { method: "GET", url: "/users" } }),
      node("wait", "delay", { label: "Wait", config: { duration: 100 } }),
    ];
    const edges = [edge("a", "save"), edge("a", "get"), edge("a", "wait")];

    expect(nextNodeSteps(nodes, edges, "a").map((step) => step.detail)).toEqual([
      "click getByRole('button', { name: 'Save' })",
      "GET /users",
      null,
    ]);
  });
});

describe("previousStepsFor", () => {
  const nodes = [node("b"), node("c"), node("m", "merge")];
  const edges = [edge("b", "m"), edge("c", "m")];

  it("goes back the way the editor came, even into a merge with several parents", () => {
    expect(ids(previousStepsFor(nodes, edges, "m", ["c"]))).toEqual(["c"]);
  });

  it("falls back to the incoming edges with no trail, or a trail whose node is gone", () => {
    expect(ids(previousStepsFor(nodes, edges, "m", []))).toEqual(["b", "c"]);
    expect(ids(previousStepsFor(nodes, edges, "m", ["deleted"]))).toEqual(["b", "c"]);
  });
});

describe("trailAfterStep", () => {
  it("pushes going forward and pops going back along it", () => {
    const forward = trailAfterStep(["a"], "b", "c", "next");
    expect(forward).toEqual(["a", "b"]);
    expect(trailAfterStep(forward, "c", "b", "previous")).toEqual(["a"]);
  });

  it("starts over when going back somewhere the trail did not come from", () => {
    expect(trailAfterStep(["a"], "m", "c", "previous")).toEqual([]);
  });
});

describe("isEditableNode", () => {
  // Frames and notes are edited in place on the canvas; treating them as steps
  // is what opened an empty node-details dialog on a double-click.
  it("keeps canvas objects and the terminals out of the details editor", () => {
    expect(isEditableNode(node("a"))).toBe(true);
    for (const type of ["group", "note", "start", "end"]) {
      expect(isEditableNode(node("a", type))).toBe(false);
    }
  });
});
