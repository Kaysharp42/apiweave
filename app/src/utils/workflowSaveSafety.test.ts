import { test } from "vitest";
import assert from "node:assert/strict";
import type { Node } from "@xyflow/react";
import { graphToCanvas } from "../adapters/workflowCanvas";
import { initialWorkflowGraph } from "@shared/graph/initial_workflow_graph";
import {
  isUntouchedInitialCanvas,
  shouldBlockDestructiveAutosave,
} from "./workflowSaveSafety.ts";

const initial = graphToCanvas(initialWorkflowGraph());
const largerBaseline = { nodeCount: 14, edgeCount: 13 };

test("the initial canvas is untouched, also after React Flow measures or drags a node", () => {
  assert.equal(isUntouchedInitialCanvas(initial.nodes, initial.nodes), true);

  const measuredAndMoved: Node[] = initial.nodes.map((node) => ({
    ...node,
    position: { x: node.position.x + 40, y: node.position.y },
    measured: { width: 120, height: 40 },
  }));
  assert.equal(isUntouchedInitialCanvas(measuredAndMoved, initial.nodes), true);
});

test("a hydrated Start→End canvas is not the initial canvas", () => {
  // Same shape as the blank graph, but built by hydration: fresh data objects.
  const hydrated = graphToCanvas(initialWorkflowGraph()).nodes;
  assert.equal(isUntouchedInitialCanvas(hydrated, initial.nodes), false);
  assert.equal(isUntouchedInitialCanvas([], initial.nodes), false);
});

test("a canvas with a node the user added is not the initial canvas", () => {
  const edited: Node[] = [
    ...initial.nodes,
    { id: "http-1", position: { x: 0, y: 0 }, data: {} },
  ];
  assert.equal(isUntouchedInitialCanvas(edited, initial.nodes), false);
});

test("blocks the untouched initial canvas against a larger baseline", () => {
  assert.equal(shouldBlockDestructiveAutosave(true, largerBaseline), true);
});

test("allows a user-edited canvas even when it is back to Start→End", () => {
  assert.equal(shouldBlockDestructiveAutosave(false, largerBaseline), false);
});

test("allows the initial canvas over a blank or missing baseline", () => {
  assert.equal(
    shouldBlockDestructiveAutosave(true, { nodeCount: 2, edgeCount: 1 }),
    false,
  );
  assert.equal(shouldBlockDestructiveAutosave(true, null), false);
});
