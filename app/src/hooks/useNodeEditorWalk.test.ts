import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Edge, Node } from "@xyflow/react";
import { useNodeEditorWalk } from "./useNodeEditorWalk";
import type { NodeStep } from "../types/NodeStep";
import type { WorkflowCanvasNodeData } from "../types/WorkflowCanvasNodeData";

function node(id: string, type = "http-request"): Node<WorkflowCanvasNodeData> {
  return { id, type, position: { x: 0, y: 0 }, data: { label: id } };
}

// a → assert ─pass→ ok ─→ merge
//            └fail→ bad ─┘
const nodes = [node("a"), node("assert", "assertion"), node("ok"), node("bad"), node("merge", "merge")];
const edges: Edge[] = [
  { id: "1", source: "a", target: "assert" },
  { id: "2", source: "assert", target: "ok", sourceHandle: "pass" },
  { id: "3", source: "assert", target: "bad", sourceHandle: "fail" },
  { id: "4", source: "ok", target: "merge" },
  { id: "5", source: "bad", target: "merge" },
];

const ids = (steps: readonly NodeStep[]) => steps.map((step) => step.nodeId);

function walk() {
  const hook = renderHook(() => useNodeEditorWalk(nodes, edges));
  const stepTo = (direction: "previous" | "next", nodeId: string) => {
    const options =
      direction === "next" ? hook.result.current.steps.next : hook.result.current.steps.previous;
    const step = options.find((candidate) => candidate.nodeId === nodeId);
    if (!step) throw new Error(`${nodeId} is not a ${direction} step`);
    act(() => hook.result.current.steps.onStep(direction, step));
  };
  return { hook, stepTo };
}

describe("useNodeEditorWalk", () => {
  it("opens on a node with its neighbours and no arrival direction", () => {
    const { hook } = walk();
    act(() => hook.result.current.openNodeEditor(node("assert", "assertion")));

    expect(hook.result.current.modalNode?.id).toBe("assert");
    expect(ids(hook.result.current.steps.previous)).toEqual(["a"]);
    expect(ids(hook.result.current.steps.next)).toEqual(["ok", "bad"]);
    expect(hook.result.current.steps.arrivedBy).toBeNull();
  });

  it("goes back the way it came through a merge, not to the merge's first input", () => {
    const { hook, stepTo } = walk();
    act(() => hook.result.current.openNodeEditor(node("assert", "assertion")));

    stepTo("next", "bad");
    stepTo("next", "merge");
    expect(hook.result.current.steps.arrivedBy).toBe("next");
    expect(ids(hook.result.current.steps.previous)).toEqual(["bad"]);

    stepTo("previous", "bad");
    stepTo("previous", "assert");
    expect(hook.result.current.modalNode?.id).toBe("assert");
    expect(hook.result.current.steps.arrivedBy).toBe("previous");
  });

  it("with no trail, offers every input of a merge", () => {
    const { hook } = walk();
    act(() => hook.result.current.openNodeEditor(node("merge", "merge")));

    expect(ids(hook.result.current.steps.previous)).toEqual(["ok", "bad"]);
  });

  it("reports where a walk ended on close, and nothing when it ended where it began", () => {
    const { hook, stepTo } = walk();
    act(() => hook.result.current.openNodeEditor(node("a")));
    stepTo("next", "assert");

    let endedOn: string | null = null;
    act(() => {
      endedOn = hook.result.current.closeNodeEditor();
    });
    expect(endedOn).toBe("assert");
    expect(hook.result.current.modalNode).toBeNull();

    act(() => hook.result.current.openNodeEditor(node("a")));
    stepTo("next", "assert");
    stepTo("previous", "a");
    act(() => {
      endedOn = hook.result.current.closeNodeEditor();
    });
    expect(endedOn).toBeNull();
  });
});
