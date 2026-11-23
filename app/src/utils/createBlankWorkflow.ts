import { initialWorkflowGraph } from "@shared/graph/initial_workflow_graph";
import type { Workflow } from "../types/Workflow";
import { apiweave } from "./apiweaveClient";

/** Create a new, empty workflow (Start → End, no variables) in a workspace, or in one of its projects. */
export function createBlankWorkflow(workspaceId: string, name: string, collectionId?: string): Promise<Workflow> {
  return apiweave.workflows.create({
    workspaceId,
    ...(collectionId !== undefined ? { collectionId } : {}),
    name,
    description: "",
    ...initialWorkflowGraph(),
    variables: {},
  });
}
