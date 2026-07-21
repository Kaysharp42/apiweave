import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useHydration } from "./useHydration";
import type { Workflow } from "@shared/types/Workflow";

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    workflowId: "wf1",
    workspaceId: "ws1",
    name: "wf",
    nodes: [
      { nodeId: "n1", type: "http", position: { x: 0, y: 0 }, config: {} },
    ],
    edges: [],
    variables: {},
    tags: [],
    nodeTemplates: [],
    rev: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Workflow;
}

describe("useHydration", () => {
  it("re-hydrates on content change but not on rev-only echoes", () => {
    const setNodes = vi.fn();
    const setEdges = vi.fn();
    const { rerender } = renderHook(
      ({ workflow }) => useHydration({ workflow, setNodes, setEdges }),
      { initialProps: { workflow: makeWorkflow() } },
    );

    // initial hydration
    expect(setNodes).toHaveBeenCalledTimes(1);

    // save echo: only rev/updatedAt bumped, new object identity -> no re-hydrate
    rerender({
      workflow: makeWorkflow({ rev: 2, updatedAt: "2026-01-02T00:00:00.000Z" }),
    });
    expect(setNodes).toHaveBeenCalledTimes(1);

    // genuine content change -> re-hydrate
    rerender({
      workflow: makeWorkflow({
        rev: 3,
        nodes: [
          { nodeId: "n1", type: "http", position: { x: 5, y: 5 }, config: {} },
        ],
      }),
    });
    expect(setNodes).toHaveBeenCalledTimes(2);
  });
});
