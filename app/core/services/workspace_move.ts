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
  return retargetCallWorkflows(nodes, (targetWorkflowId) => keptWorkflowIds.has(targetWorkflowId) ? targetWorkflowId : null)
}

/**
 * Point every Call Workflow node at `retarget(targetWorkflowId)`; `null` clears
 * the target (and its denormalized name). A node whose target comes back
 * unchanged is returned as is. Shared by workspace moves (keep or clear) and
 * imports (re-point at the imported copy, keep, or clear).
 */
export function retargetCallWorkflows(
  nodes: Workflow["nodes"],
  retarget: (targetWorkflowId: string, node: Workflow["nodes"][number]) => string | null,
): Workflow["nodes"] {
  return nodes.map((node) => {
    if (node.type !== "workflow") return node
    const targetWorkflowId = node.config?.targetWorkflowId
    if (!targetWorkflowId) return node
    const next = retarget(targetWorkflowId, node)
    if (next === targetWorkflowId) return node
    return {
      ...node,
      config: next === null
        ? { ...node.config, targetWorkflowId: null, targetWorkflowName: null }
        : { ...node.config, targetWorkflowId: next },
    }
  })
}

/** The import warning for a Call Workflow target that is neither in the bundle nor in the destination workspace. */
export function callTargetClearedWarning(nodeLabel: string, workflowName: string, targetWorkflowId: string): string {
  return `Call Workflow node '${nodeLabel}' in workflow '${workflowName}' targeted workflow '${targetWorkflowId}', which is not in the import or this workspace; its target was cleared`
}
