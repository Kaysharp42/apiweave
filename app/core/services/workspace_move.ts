import type { Workflow } from "@shared/types/Workflow"

/**
 * Null every Call Workflow target that is NOT coming along on a cross-workspace
 * move.
 *
 * A `workflow`-type node may only target a workflow in its own workspace —
 * `WorkflowService.assertCallWorkflowTargetsInWorkspace` enforces that on every
 * create, update and patch. So a moved graph that kept a target left behind in
 * the source workspace would be unsaveable: the move itself succeeds, and it is
 * the user's *next* ordinary edit that fails, with a `target workflow ... not
 * found` they have no way to act on. Clearing the target at move time trades a
 * config loss the user was warned about for a workflow that still works.
 *
 * `keptWorkflowIds` is the set of workflow ids moving in the same operation:
 * empty for a lone workflow, and the project's members for a project move,
 * where a call between two workflows in that project stays valid either side of
 * the border.
 */
export function clearDepartingCallTargets(
  nodes: Workflow["nodes"],
  keptWorkflowIds: ReadonlySet<string>,
): Workflow["nodes"] {
  return nodes.map((node) => {
    if (node.type !== "workflow") return node
    const targetWorkflowId = node.config?.targetWorkflowId
    if (!targetWorkflowId || keptWorkflowIds.has(targetWorkflowId)) return node
    return {
      ...node,
      config: { ...node.config, targetWorkflowId: null, targetWorkflowName: null },
    }
  })
}
