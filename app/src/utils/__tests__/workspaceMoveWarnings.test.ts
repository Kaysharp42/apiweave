import { describe, expect, it } from "vitest";
import type { Workflow } from "../../types/Workflow";
import type { Project } from "../../types/Project";
import type { ScopedEnvironment } from "../../types/ScopedEnvironment";
import {
  projectMoveWarnings,
  workflowMoveWarnings,
} from "../workspaceMoveWarnings";

function workflow(): Workflow {
  return {
    workflowId: "wf-1",
    workspaceId: "ws-1",
    name: "Checkout",
    description: null,
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
  } as unknown as Workflow;
}

/** A Call Workflow node pointing at `targetWorkflowId`. */
function callNode(nodeId: string, targetWorkflowId: string) {
  return {
    nodeId,
    type: "workflow",
    position: { x: 0, y: 0 },
    config: { targetWorkflowId, targetWorkflowName: "Callee" },
  } as unknown as Workflow["nodes"][number];
}

function project(collectionId: string, name: string): Project {
  return { collectionId, name } as unknown as Project;
}

function environment(environmentId: string, name: string): ScopedEnvironment {
  return { environmentId, name } as unknown as ScopedEnvironment;
}

describe("workflowMoveWarnings", () => {
  it("says nothing when the workflow has no workspace-scoped references", () => {
    expect(workflowMoveWarnings(workflow(), [], [])).toEqual([]);
  });

  it("names the project and environment it is about to lose", () => {
    const warnings = workflowMoveWarnings(
      { ...workflow(), collectionId: "col-1", selectedEnvironmentId: "env-1" },
      [project("col-1", "Payments")],
      [environment("env-1", "Staging")],
    );

    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('"Payments"');
    expect(warnings[1]).toContain('"Staging"');
  });

  it("still reports a reference it cannot name", () => {
    // The sidebar's project list depends on which tab was last refreshed, so an
    // unresolvable id must degrade to an unnamed warning, never to silence.
    const warnings = workflowMoveWarnings(
      { ...workflow(), collectionId: "col-gone", selectedEnvironmentId: "env-gone" },
      [],
      [],
    );

    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("its current project");
    expect(warnings[1]).toContain("selected environment is cleared");
  });

  it("counts every call target, since a lone workflow takes none with it", () => {
    const warnings = workflowMoveWarnings(
      {
        ...workflow(),
        nodes: [callNode("call-1", "wf-2"), callNode("call-2", "wf-3")],
      },
      [],
      [],
    );

    expect(warnings).toEqual([
      "2 Call Workflow nodes lose their targets and need new ones picked.",
    ]);
  });

  it("ignores a call node that never had a target", () => {
    const untargeted = {
      nodeId: "call-1",
      type: "workflow",
      position: { x: 0, y: 0 },
      config: { targetWorkflowId: null },
    } as unknown as Workflow["nodes"][number];

    expect(workflowMoveWarnings({ ...workflow(), nodes: [untargeted] }, [], [])).toEqual(
      [],
    );
  });
});

describe("projectMoveWarnings", () => {
  it("says nothing for an empty project", () => {
    expect(projectMoveWarnings([], [])).toEqual([]);
  });

  it("counts the workflows travelling and the environments cleared", () => {
    const members = [
      { ...workflow(), workflowId: "wf-1", selectedEnvironmentId: "env-1" },
      { ...workflow(), workflowId: "wf-2", selectedEnvironmentId: "env-1" },
      { ...workflow(), workflowId: "wf-3" },
    ];

    const warnings = projectMoveWarnings(members, [environment("env-1", "Staging")]);

    expect(warnings[0]).toBe("3 workflows move with the project.");
    expect(warnings[1]).toBe(
      "Selected environments are cleared on 2 workflows (Staging).",
    );
  });

  it("only counts calls that point outside the project", () => {
    const members = [
      { ...workflow(), workflowId: "wf-1", nodes: [callNode("call-1", "wf-2")] },
      { ...workflow(), workflowId: "wf-2", nodes: [callNode("call-1", "wf-outside")] },
    ];

    const warnings = projectMoveWarnings(members, []);

    // wf-1 → wf-2 travels with the project and survives; wf-2 → wf-outside does not.
    expect(warnings).toEqual([
      "2 workflows move with the project.",
      "1 Call Workflow node targets a workflow outside this project and loses that target.",
    ]);
  });
});
