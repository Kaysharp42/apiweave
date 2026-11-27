import { analyzeWorkflowGraph } from "@shared/analysis/workflow_graph_analyzer"
import { callerSuppliedVariableNames } from "@shared/analysis/variable_references"
import type { Workflow } from "@shared/types/Workflow"
import type { WorkflowNode } from "@shared/types/WorkflowNode"
import type { WorkflowDiagnosis } from "@shared/types/WorkflowDiagnosis"
import { NotFoundError } from "../ipc/errors"
import type { RunService } from "./run_service"
import type { WorkflowService } from "./workflow_service"

/** The workflow a Call Workflow node calls, when it names one. */
function calledWorkflowId(node: WorkflowNode): string | undefined {
  if (node.type !== "workflow") return undefined
  const targetId = node.config?.targetWorkflowId
  return typeof targetId === "string" ? targetId : undefined
}

/** The ids of the workflows a graph calls, in node order. */
function calledWorkflowIds(workflow: Workflow): string[] {
  return workflow.nodes.flatMap((node) => {
    const targetId = calledWorkflowId(node)
    return targetId === undefined ? [] : [targetId]
  })
}

/** Authorized orchestration around the deterministic persisted-graph analyzer. */
export class WorkflowAnalysisService {
  constructor(
    private readonly workflows: WorkflowService,
    private readonly runs: RunService,
  ) {}

  async diagnose(workspaceId: string, workflowId: string, runId?: string): Promise<WorkflowDiagnosis> {
    const workflow = await this.workflows.get(workspaceId, workflowId)
    const browserStepWorkflowIds = await this.browserStepWorkflowIds(workspaceId, workflow)
    const callers = await this.workflows.listCallers(workspaceId, workflowId)
    const callerVariableNames = callerSuppliedVariableNames(callers.flatMap((caller) => caller.nodes), workflowId)
    const input = { ...workflow, browserStepWorkflowIds, callerVariableNames }
    if (runId === undefined) return analyzeWorkflowGraph(input)

    const run = await this.runs.get(workspaceId, runId)
    if (run.workflowId !== workflowId) {
      // Hide whether the supplied run belongs to a different workflow.
      throw new NotFoundError(`run ${run.runId} not found`)
    }
    return analyzeWorkflowGraph(input, run)
  }

  /**
   * Which of the workflows this one calls, directly or through further calls,
   * have a `browser` step. The analyzer counts a Call Workflow node into one of
   * them as part of the browser chain, because the call drives the same page.
   * A target that no longer exists contributes nothing.
   */
  private async browserStepWorkflowIds(workspaceId: string, workflow: Workflow): Promise<readonly string[]> {
    const nodesByWorkflowId = new Map<string, Workflow["nodes"]>()
    const pending = calledWorkflowIds(workflow)
    for (let targetId = pending.pop(); targetId !== undefined; targetId = pending.pop()) {
      if (nodesByWorkflowId.has(targetId)) continue
      const target = await this.getOrUndefined(workspaceId, targetId)
      if (target === undefined) continue
      nodesByWorkflowId.set(targetId, target.nodes)
      pending.push(...calledWorkflowIds(target))
    }

    const reachesBrowser = (workflowId: string, seen: ReadonlySet<string>): boolean => {
      const nodes = nodesByWorkflowId.get(workflowId)
      if (nodes === undefined || seen.has(workflowId)) return false
      const path = new Set(seen).add(workflowId)
      return nodes.some((node) => {
        const targetId = calledWorkflowId(node)
        return node.type === "browser" || (targetId !== undefined && reachesBrowser(targetId, path))
      })
    }
    return [...nodesByWorkflowId.keys()].filter((workflowId) => reachesBrowser(workflowId, new Set()))
  }

  private async getOrUndefined(workspaceId: string, workflowId: string): Promise<Workflow | undefined> {
    try {
      return await this.workflows.get(workspaceId, workflowId)
    } catch (error) {
      if (error instanceof NotFoundError) return undefined
      throw error
    }
  }
}
