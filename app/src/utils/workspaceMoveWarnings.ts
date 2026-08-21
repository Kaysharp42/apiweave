import type { Workflow } from "../types/Workflow";
import type { Project } from "../types/Project";
import type { ScopedEnvironment } from "../types/ScopedEnvironment";

/**
 * What a cross-workspace move costs, phrased for the confirmation dialog.
 *
 * The rules here restate the ones the server enforces in
 * `core/services/workspace_move.ts` and `WorkflowService.moveToWorkspace` — a
 * workspace is the scope an environment, a project and a Call Workflow target
 * resolve in, so none of them can follow the item across. That duplication is
 * deliberate: this side turns the rule into a sentence the user reads *before*
 * confirming, and the server clears the references whether or not anyone looked.
 * Keep the two in step — a warning that omits a reference the server still
 * clears is worse than no dialog at all.
 */

/** Call Workflow nodes whose target is not itself part of the move. */
function departingCallTargets(
  workflow: Workflow,
  movingWorkflowIds: ReadonlySet<string>,
): number {
  return (workflow.nodes ?? []).filter(
    (node) =>
      node.type === "workflow" &&
      typeof node.config?.targetWorkflowId === "string" &&
      !movingWorkflowIds.has(node.config.targetWorkflowId),
  ).length;
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function environmentName(
  environmentId: string | null | undefined,
  environments: readonly ScopedEnvironment[],
): string | null {
  if (!environmentId) return null;
  return (
    environments.find((env) => env.environmentId === environmentId)?.name ?? null
  );
}

/** Warnings for moving one workflow out of its workspace. */
export function workflowMoveWarnings(
  workflow: Workflow,
  projects: readonly Project[],
  environments: readonly ScopedEnvironment[],
): string[] {
  const warnings: string[] = [];

  // Named when the caller's project list happens to hold it, unnamed otherwise —
  // never omitted. The list the sidebar has depends on which tab was last
  // refreshed, and a reference the server clears has to be reported either way.
  if (workflow.collectionId) {
    const currentProject = projects.find(
      (project) =>
        (project.projectId ?? project.collectionId) === workflow.collectionId,
    );
    warnings.push(
      currentProject
        ? `It leaves the project "${currentProject.name}" — a project belongs to one workspace, so it cannot follow.`
        : "It leaves its current project — a project belongs to one workspace, so it cannot follow.",
    );
  }

  const envName = environmentName(workflow.selectedEnvironmentId, environments);
  if (workflow.selectedEnvironmentId) {
    warnings.push(
      envName === null
        ? "Its selected environment is cleared."
        : `Its selected environment "${envName}" is cleared.`,
    );
  }

  // A lone workflow takes no call targets with it, so every one of them departs.
  const callTargets = departingCallTargets(workflow, new Set());
  if (callTargets === 1) {
    warnings.push(
      "1 Call Workflow node loses its target and needs a new one picked.",
    );
  } else if (callTargets > 1) {
    warnings.push(
      `${callTargets} Call Workflow nodes lose their targets and need new ones picked.`,
    );
  }

  return warnings;
}

/** Warnings for moving a project, and the workflows in it, out of its workspace. */
export function projectMoveWarnings(
  members: readonly Workflow[],
  environments: readonly ScopedEnvironment[],
): string[] {
  const warnings: string[] = [];

  if (members.length > 0) {
    warnings.push(
      `${plural(members.length, "workflow")} move with the project.`,
    );
  }

  const withEnvironment = members.filter(
    (workflow) => workflow.selectedEnvironmentId,
  );
  if (withEnvironment.length > 0) {
    const names = withEnvironment
      .map((workflow) =>
        environmentName(workflow.selectedEnvironmentId, environments),
      )
      .filter((name): name is string => name !== null);
    const unique = [...new Set(names)];
    warnings.push(
      unique.length > 0
        ? `Selected environments are cleared on ${plural(withEnvironment.length, "workflow")} (${unique.join(", ")}).`
        : `Selected environments are cleared on ${plural(withEnvironment.length, "workflow")}.`,
    );
  }

  // Calls *inside* the project survive — those workflows travel together.
  const movingWorkflowIds = new Set(
    members.map((workflow) => workflow.workflowId),
  );
  const callTargets = members.reduce(
    (total, workflow) => total + departingCallTargets(workflow, movingWorkflowIds),
    0,
  );
  if (callTargets === 1) {
    warnings.push(
      "1 Call Workflow node targets a workflow outside this project and loses that target.",
    );
  } else if (callTargets > 1) {
    warnings.push(
      `${callTargets} Call Workflow nodes target a workflow outside this project and lose those targets.`,
    );
  }

  return warnings;
}
