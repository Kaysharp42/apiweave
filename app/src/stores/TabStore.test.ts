import { test } from "vitest";
import assert from "node:assert/strict";
import useTabStore from "./TabStore";
import type { Workflow } from "../types/Workflow";

const resetStore = () => {
  useTabStore.setState({
    tabs: [],
    activeTabIdByWorkspace: {},
  });
};

test("openTab creates a new tab for a workflow", () => {
  resetStore();

  const workflow = {
    workflowId: "wf-1",
    workspaceId: "ws-1",
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
  assert.equal(state.activeTabIdByWorkspace["ws-1"], "wf-1");
  const tab = state.tabs[0]!;
  assert.equal(tab.workflowId, "wf-1");
  assert.deepEqual(tab.workflow!.nodes, workflow.nodes);
});

test("openTab refreshes workflow payload for an existing tab", () => {
  resetStore();

  const minimalWorkflow = {
    workflowId: "wf-42",
    workspaceId: "ws-1",
    name: "Orders Flow",
    nodes: [{ nodeId: "start-1", type: "start" }],
    edges: [],
    variables: { catID: "response.body.id" },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as unknown as Workflow;

  const fullWorkflow = {
    workflowId: "wf-42",
    workspaceId: "ws-1",
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
  assert.equal(state.activeTabIdByWorkspace["ws-1"], "wf-42");
  const tab = state.tabs[0]!;
  assert.equal(tab.workflow!.nodes.length, 3);
  assert.equal(tab.workflow!.edges.length, 2);
  assert.deepEqual(tab.workflow!.variables, fullWorkflow.variables);
});

test("updateTabWorkflow replaces stored workflow snapshot", () => {
  resetStore();

  const original = {
    workflowId: "wf-88",
    workspaceId: "ws-1",
    name: "Billing",
    nodes: [{ nodeId: "start-1", type: "start" }],
    edges: [],
    variables: {},
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as unknown as Workflow;

  const updated = {
    workflowId: "wf-88",
    workspaceId: "ws-1",
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

test("tabs stay scoped to the workspace their workflow lives in", () => {
  resetStore();

  const inWsOne = {
    workflowId: "wf-a",
    workspaceId: "ws-1",
    name: "Actor Module",
    nodes: [],
    edges: [],
    variables: {},
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as unknown as Workflow;

  const inWsTwo = {
    workflowId: "wf-b",
    workspaceId: "ws-2",
    name: "Billing",
    nodes: [],
    edges: [],
    variables: {},
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as unknown as Workflow;

  useTabStore.getState().openTab(inWsOne);
  useTabStore.getState().openTab(inWsTwo);

  const opened = useTabStore.getState();
  assert.equal(opened.tabs.length, 2);
  // Each workspace remembers its own active tab, so switching back to ws-1
  // restores wf-a rather than showing ws-2's tab under ws-1's id.
  assert.equal(opened.activeTabIdByWorkspace["ws-1"], "wf-a");
  assert.equal(opened.activeTabIdByWorkspace["ws-2"], "wf-b");

  // Closing one workspace's tabs leaves the other workspace untouched.
  useTabStore.getState().closeAll("ws-2");
  const afterScopedClose = useTabStore.getState();
  assert.deepEqual(
    afterScopedClose.tabs.map((t) => t.workflowId),
    ["wf-a"],
  );
  assert.equal(afterScopedClose.activeTabIdByWorkspace["ws-2"], undefined);
  assert.equal(afterScopedClose.activeTabIdByWorkspace["ws-1"], "wf-a");

  // The account reset closes everything, whatever workspace it belongs to.
  useTabStore.getState().closeAll();
  assert.equal(useTabStore.getState().tabs.length, 0);
  assert.deepEqual(useTabStore.getState().activeTabIdByWorkspace, {});
});

test("tab cycling stays inside the current workspace", () => {
  resetStore();

  const make = (workflowId: string, workspaceId: string) =>
    ({
      workflowId,
      workspaceId,
      name: workflowId,
      nodes: [],
      edges: [],
      variables: {},
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    }) as unknown as Workflow;

  const tabs = useTabStore.getState();
  tabs.openTab(make("wf-1", "ws-1"));
  tabs.openTab(make("wf-2", "ws-2"));
  tabs.openTab(make("wf-3", "ws-1"));

  useTabStore.getState().setActive("wf-1");
  useTabStore.getState().activateNextTab("ws-1");
  assert.equal(useTabStore.getState().activeTabIdByWorkspace["ws-1"], "wf-3");

  useTabStore.getState().activateNextTab("ws-1");
  assert.equal(useTabStore.getState().activeTabIdByWorkspace["ws-1"], "wf-1");

  useTabStore.getState().activatePrevTab("ws-1");
  assert.equal(useTabStore.getState().activeTabIdByWorkspace["ws-1"], "wf-3");

  // ws-2 has a single tab, so cycling there is a no-op rather than a jump into
  // ws-1's tabs.
  useTabStore.getState().activateNextTab("ws-2");
  assert.equal(useTabStore.getState().activeTabIdByWorkspace["ws-2"], "wf-2");
});
