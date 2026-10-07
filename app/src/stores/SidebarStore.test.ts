import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Workflow } from "../types/Workflow";

vi.mock("../utils/apiweaveClient", () => ({
  apiweave: {
    workflows: { list: vi.fn().mockResolvedValue({ items: [], total: 0 }) },
    projects: { list: vi.fn().mockResolvedValue({ items: [], total: 0 }) },
  },
}));

import useSidebarStore from "./SidebarStore";

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    workflowId: "wf1",
    workspaceId: "ws1",
    name: "Workflow",
    nodes: [],
    edges: [],
    variables: {},
    tags: [],
    collectionId: null,
    selectedEnvironmentId: null,
    nodeTemplates: [],
    rev: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Workflow;
}

describe("SidebarStore.applyWorkflowChange", () => {
  beforeEach(() => {
    useSidebarStore.setState({
      workflows: [],
      allWorkflows: [],
      activeWorkspaceId: "ws1",
      workflowVersion: 0,
    });
  });

  it("patches a cached row in place without a refetch", () => {
    const cached = makeWorkflow();
    useSidebarStore.setState({
      workflows: [cached, makeWorkflow({ workflowId: "wf2" })],
      allWorkflows: [cached],
    });

    useSidebarStore
      .getState()
      .applyWorkflowChange(makeWorkflow({ name: "Renamed", rev: 2 }));

    const state = useSidebarStore.getState();
    expect(state.workflows.map((w) => w.name)).toEqual(["Renamed", "Workflow"]);
    expect(state.allWorkflows[0]?.name).toBe("Renamed");
    expect(state.workflowVersion).toBe(0);
  });

  it("drops a row that became attached to a project from the flat list", () => {
    const cached = makeWorkflow();
    useSidebarStore.setState({ workflows: [cached], allWorkflows: [cached] });

    useSidebarStore
      .getState()
      .applyWorkflowChange(makeWorkflow({ collectionId: "project-1", rev: 2 }));

    const state = useSidebarStore.getState();
    // `fetchWorkflows` passes includeAttached: false, so an attached row does
    // not belong in `workflows` — leaving it there showed it under the flat
    // section with a collectionId saying otherwise.
    expect(state.workflows).toEqual([]);
    // It is still part of the workspace, so the full list keeps it, updated.
    expect(state.allWorkflows).toHaveLength(1);
    expect(state.allWorkflows[0]?.collectionId).toBe("project-1");
  });

  it("drops a row that moved to another workspace from both lists", () => {
    const cached = makeWorkflow();
    useSidebarStore.setState({ workflows: [cached], allWorkflows: [cached] });

    useSidebarStore
      .getState()
      .applyWorkflowChange(makeWorkflow({ workspaceId: "ws2", rev: 2 }));

    const state = useSidebarStore.getState();
    expect(state.workflows).toEqual([]);
    expect(state.allWorkflows).toEqual([]);
  });

  it("refetches when a row becomes newly eligible for the flat list", () => {
    // Cached as attached in the full list only; detaching it should surface it
    // under the flat section, at a position only the server can decide.
    useSidebarStore.setState({
      workflows: [],
      allWorkflows: [makeWorkflow({ collectionId: "project-1" })],
    });

    useSidebarStore
      .getState()
      .applyWorkflowChange(makeWorkflow({ collectionId: null, rev: 2 }));

    expect(useSidebarStore.getState().workflowVersion).toBe(1);
  });

  it("ignores a row cached in neither list", () => {
    useSidebarStore.setState({
      workflows: [makeWorkflow({ workflowId: "wf-other" })],
      allWorkflows: [],
    });

    useSidebarStore.getState().applyWorkflowChange(makeWorkflow({ rev: 2 }));

    const state = useSidebarStore.getState();
    // Nothing on screen is stale, so there is nothing to refetch.
    expect(state.workflowVersion).toBe(0);
    expect(state.workflows).toHaveLength(1);
  });
});
