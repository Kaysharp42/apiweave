import { getSidebarItemLabel } from "./sidebarItemLabel";
import type { Project } from "../types/Project";
import type { ScopedEnvironment } from "../types/ScopedEnvironment";
import type { Workflow } from "../types/Workflow";

type ItemLabel = ReturnType<typeof getSidebarItemLabel>;

export interface WorkflowRowLabels {
  readonly name: ItemLabel;
  /** Null when the workflow is in no project, or its project is not in `collections`. */
  readonly collection: ItemLabel | null;
  /** Null when no environment is selected for this workflow. */
  readonly environment: ItemLabel | null;
}

/**
 * The three truncated labels a sidebar workflow row shows.
 *
 * Pulled out of `WorkflowItem` because resolving them is five chained
 * "present or not" decisions that say nothing about how the row renders, and
 * leaving them inline put the component over the cognitive-complexity budget.
 *
 * The selected environment is read from `localStorage`, not from
 * `workflow.selectedEnvironmentId` — the canvas has always written the user's
 * per-workflow pick there, and this row reflects what the canvas will use.
 */
export function workflowRowLabels(
  workflow: Workflow,
  collections: readonly Project[],
  environments: readonly ScopedEnvironment[],
): WorkflowRowLabels {
  const environmentId = localStorage.getItem(
    `selectedEnvironment_${workflow.workflowId}`,
  );
  const environmentName = environmentId
    ? environments.find((env) => env.environmentId === environmentId)?.name
    : undefined;
  const collectionName = workflow.collectionId
    ? collections.find(
        (collection) => collection.collectionId === workflow.collectionId,
      )?.name
    : undefined;

  return {
    name: getSidebarItemLabel(workflow.name, 32, "Untitled workflow"),
    collection: collectionName
      ? getSidebarItemLabel(collectionName, 18, "Collection")
      : null,
    environment: environmentName
      ? getSidebarItemLabel(environmentName, 16, "Environment")
      : null,
  };
}
