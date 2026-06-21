import { test } from "vitest";
import assert from "node:assert/strict";
import useTabStore from "./TabStore";
import type { Workflow } from "../types/Workflow";

const resetStore = () => {
  useTabStore.setState({
    tabs: [],
    activeTabId: null,
  });
};

test("openTab creates a new tab for a workflow", () => {
  resetStore();

  const workflow = {
    workflowId: "wf-1",
    name: "Workflow 1",
    nodes: [{ nodeId: "start-1" }],
    edges: [],
    variables: {},
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as unknown as Workflow;

  useTabStore.getState().openTab(workflow);

  const state = useTabStore.getState();
  assert.equal(state.tabs.length, 1);
  assert.equal(state.activeTabId, "wf-1");
  const tab = state.tabs[0]!;
  assert.equal(tab.workflowId, "wf-1");
  assert.deepEqual(tab.workflow!.nodes, workflow.nodes);
});

test("openTab refreshes workflow payload for an existing tab", () => {
  resetStore();

  const minimalWorkflow = {
    workflowId: "wf-42",
    name: "Orders Flow",
    nodes: [{ nodeId: "start-1", type: "start" }],
    edges: [],
    variables: { catID: "response.body.id" },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as unknown as Workflow;

  const fullWorkflow = {
    workflowId: "wf-42",
    name: "Orders Flow",
    nodes: [
      { nodeId: "start-1", type: "start" },
      { nodeId: "node-2", type: "http-request" },
      { nodeId: "node-3", type: "assertion" },
    ],
    edges: [
      { edgeId: "e-1", source: "start-1", target: "node-2" },
      { edgeId: "e-2", source: "node-2", target: "node-3" },
    ],
    variables: { catID: "response.body.id", orderId: "response.body.orderId" },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as unknown as Workflow;

  useTabStore.getState().openTab(minimalWorkflow);
  useTabStore.getState().openTab(fullWorkflow);

  const state = useTabStore.getState();
  assert.equal(state.tabs.length, 1);
  assert.equal(state.activeTabId, "wf-42");
  const tab = state.tabs[0]!;
  assert.equal(tab.workflow!.nodes.length, 3);
  assert.equal(tab.workflow!.edges.length, 2);
  assert.deepEqual(tab.workflow!.variables, fullWorkflow.variables);
});

test("updateTabWorkflow replaces stored workflow snapshot", () => {
  resetStore();

  const original = {
    workflowId: "wf-88",
    name: "Billing",
    nodes: [{ nodeId: "start-1", type: "start" }],
    edges: [],
    variables: {},
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as unknown as Workflow;

  const updated = {
    workflowId: "wf-88",
    name: "Billing v2",
    nodes: [
      { nodeId: "start-1", type: "start" },
      { nodeId: "node-10", type: "http-request" },
    ],
    edges: [{ edgeId: "e-10", source: "start-1", target: "node-10" }],
    variables: { token: "response.body.token" },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as unknown as Workflow;

  useTabStore.getState().openTab(original);
  useTabStore.getState().updateTabWorkflow("wf-88", updated);

  const state = useTabStore.getState();
  const tab = state.tabs[0]!;
  assert.equal(tab.name, "Billing v2");
  assert.equal(tab.workflow!.nodes.length, 2);
  assert.equal(tab.workflow!.edges.length, 1);
  assert.deepEqual(tab.workflow!.variables, updated.variables);
});
