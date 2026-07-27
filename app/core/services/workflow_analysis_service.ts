import { analyzeWorkflowGraph } from "@shared/analysis/workflow_graph_analyzer"
import type { WorkflowDiagnosis } from "@shared/types/WorkflowDiagnosis"
import { NotFoundError } from "../ipc/errors"
import type { RunService } from "./run_service"
import type { WorkflowService } from "./workflow_service"

/** Authorized orchestration around the deterministic persisted-graph analyzer. */
export class WorkflowAnalysisService {
  constructor(
    private readonly workflows: WorkflowService,
    private readonly runs: RunService,
  ) {}

  async diagnose(workspaceId: string, workflowId: string, runId?: string): Promise<WorkflowDiagnosis> {
    const workflow = await this.workflows.get(workspaceId, workflowId)
    if (runId === undefined) return analyzeWorkflowGraph(workflow)

    const run = await this.runs.get(workspaceId, runId)
    if (run.workflowId !== workflowId) {
      // Hide whether the supplied run belongs to a different workflow.
      throw new NotFoundError(`run ${run.runId} not found`)
    }
    return analyzeWorkflowGraph(workflow, run)
  }
}
