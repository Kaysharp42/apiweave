import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Workflow } from "../types/Workflow";

vi.mock("../utils/apiweaveClient", () => ({
  authenticatedFetch: vi.fn(),
  projectsUrl: vi.fn(),
  workflowsUrl: vi.fn(),
  default: "http://localhost",
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
      pagination: { skip: 0, limit: 20, total: 0, hasMore: false },
    });
  });

  it("patches a cached row in place without resetting pagination", () => {
    const cached = makeWorkflow();
    useSidebarStore.setState({
      workflows: [cached, makeWorkflow({ workflowId: "wf2" })],
      allWorkflows: [cached],
      pagination: { skip: 80, limit: 20, total: 100, hasMore: true },
    });

    useSidebarStore
      .getState()
      .applyWorkflowChange(makeWorkflow({ name: "Renamed", rev: 2 }));

    const state = useSidebarStore.getState();
    expect(state.workflows.map((w) => w.name)).toEqual(["Renamed", "Workflow"]);
    expect(state.allWorkflows[0]?.name).toBe("Renamed");
    // The whole point of patching rather than refetching.
    expect(state.pagination).toEqual({ skip: 80, limit: 20, total: 100, hasMore: true });
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
      pagination: { skip: 80, limit: 20, total: 100, hasMore: true },
    });

    useSidebarStore.getState().applyWorkflowChange(makeWorkflow({ rev: 2 }));

    const state = useSidebarStore.getState();
    // Outside the fetched window: nothing on screen is stale, so a refetch
    // would only cost the user their pagination.
    expect(state.workflowVersion).toBe(0);
    expect(state.pagination.skip).toBe(80);
    expect(state.workflows).toHaveLength(1);
  });
});
