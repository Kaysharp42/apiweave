import type { Run } from "../../../shared/types/Run"
import type { JsonValue } from "../../../shared/types/JsonValue"
import type { RunCreate, RunRepository } from "../repositories"
import type { PermissionProvider } from "../auth/PermissionProvider"
import type { SyncProvider } from "../sync/SyncProvider"
import { NotFoundError } from "../ipc/errors"
import { RESOURCE_RUNS, RESOURCE_WORKFLOWS } from "../auth/permissions"
import { authorizeWorkspace } from "./authorize"
import type { ScopeResolver } from "./scope_resolver"

/**
 * Workspace-scoped run history + the field-level write surface the executor
 * drives. Ported from Python `run_service`.
 *
 * User-facing reads (get/list/cancel) authorize through scope + permission. The
 * executor-internal progress writes (`appendNodeStatus`, `mergeExtractedVariables`,
 * `completeRun`) are NOT re-authorized per call — the run was authorized at
 * `createRun`, and re-resolving scope on every node completion is pure overhead.
 * They delegate to the repository's JSON-patch methods (decision #6b): each write
 * touches a single column, never a whole-row replace. The IPC event emission for
 * these is Task 15's concern, not this service's.
 */
export class RunService {
  constructor(
    private readonly runs: RunRepository,
    private readonly syncProvider: SyncProvider,
    private readonly permissions: PermissionProvider,
    private readonly scopeResolver: ScopeResolver,
  ) {}

  async createRun(workspaceId: string, input: Omit<RunCreate, "workspaceId">): Promise<Run> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "run", RESOURCE_WORKFLOWS)
    return this.runs.create({ ...input, workspaceId })
  }

  async get(workspaceId: string, runId: string): Promise<Run> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_RUNS)
    return this.mustGet(workspaceId, runId)
  }

  async listByWorkflow(workspaceId: string, workflowId: string): Promise<{ items: readonly Run[]; total: number }> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_RUNS)
    return this.runs.listByWorkflow(workflowId)
  }

  async listByWorkspace(workspaceId: string): Promise<{ items: readonly Run[]; total: number }> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_RUNS)
    return this.runs.listByWorkspace(workspaceId)
  }

  async getLatest(workspaceId: string, workflowId: string): Promise<Run | undefined> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_RUNS)
    return this.runs.getLatestRun(workflowId)
  }

  async getLatestFailed(workspaceId: string, workflowId: string): Promise<Run | undefined> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_RUNS)
    return this.runs.getLatestFailedRun(workflowId)
  }

  async cancel(workspaceId: string, runId: string): Promise<Run> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "cancel", RESOURCE_RUNS)
    this.mustGet(workspaceId, runId)
    const updated = this.runs.updateStatus(runId, "cancelled")
    if (updated === undefined) throw new NotFoundError(`run ${runId} not found`)
    await this.syncProvider.push()
    return updated
  }

  // --- Executor-internal progress writes (field-level, decision #6b) ---

  /** Patch one node's status entry into the run — targeted column write, not whole-row. */
  appendNodeStatus(runId: string, nodeId: string, entry: JsonValue): void {
    this.runs.appendNodeStatus(runId, nodeId, entry)
  }

  /** Merge freshly extracted variables into the run — targeted column write. */
  setExtractedVariables(runId: string, variables: Record<string, JsonValue>): void {
    this.runs.mergeExtractedVariables(runId, variables)
  }

  /** Transition the run to a terminal status (completed/failed/cancelled/interrupted). */
  completeRun(runId: string, status: Run["status"], error?: string): Run | undefined {
    return this.runs.updateStatus(runId, status, error)
  }

  private mustGet(workspaceId: string, runId: string): Run {
    const run = this.runs.getById(runId)
    if (run === undefined || run.workspaceId !== workspaceId) {
      throw new NotFoundError(`run ${runId} not found`)
    }
    return run
  }
}
