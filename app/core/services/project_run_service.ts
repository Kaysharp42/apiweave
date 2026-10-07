import type { ProjectRun } from "@shared/types/ProjectRun"
import type { CollectionRepository, ProjectRunRepository } from "../repositories"
import type { PermissionProvider } from "../auth/PermissionProvider"
import type { ProjectRunner } from "../runner/project_runner"
import { NotFoundError } from "../ipc/errors"
import { RESOURCE_RUNS, RESOURCE_WORKFLOWS } from "../auth/permissions"
import { authorizeWorkspace } from "./authorize"
import type { ScopeResolver } from "./scope_resolver"

/**
 * Workspace-scoped project runs: authorizes, then hands execution to the
 * {@link ProjectRunner}. A project run belongs to its project, so every read
 * checks that project is in the caller's workspace.
 */
export class ProjectRunService {
  constructor(
    private readonly runner: ProjectRunner,
    private readonly projectRuns: ProjectRunRepository,
    private readonly collections: CollectionRepository,
    private readonly permissions: PermissionProvider,
    private readonly scopeResolver: ScopeResolver,
  ) {}

  /** Starts the run and returns at once with it `running`; progress arrives through the runner's `onChange`. */
  async start(workspaceId: string, projectId: string, environmentId: string | null, agent?: string): Promise<ProjectRun> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "run", RESOURCE_WORKFLOWS)
    return this.runner.start({ workspaceId, projectId, environmentId, ...(agent !== undefined ? { agent } : {}) }).projectRun
  }

  /** Asks a live project run to stop and returns its record; the cancelled state follows once its current workflow run stops. */
  async cancel(workspaceId: string, projectRunId: string): Promise<ProjectRun> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "cancel", RESOURCE_RUNS)
    this.mustGet(workspaceId, projectRunId)
    this.runner.cancel(projectRunId)
    return this.mustGet(workspaceId, projectRunId)
  }

  async get(workspaceId: string, projectRunId: string): Promise<ProjectRun> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_RUNS)
    return this.mustGet(workspaceId, projectRunId)
  }

  async list(workspaceId: string, projectId: string): Promise<{ items: readonly ProjectRun[]; total: number }> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_RUNS)
    this.mustGetProject(workspaceId, projectId)
    const items = this.projectRuns.listByProject(projectId)
    return { items, total: items.length }
  }

  private mustGet(workspaceId: string, projectRunId: string): ProjectRun {
    const projectRun = this.projectRuns.getById(projectRunId)
    if (projectRun === undefined) throw new NotFoundError(`project run ${projectRunId} not found`)
    this.mustGetProject(workspaceId, projectRun.projectId, `project run ${projectRunId} not found`)
    return projectRun
  }

  private mustGetProject(workspaceId: string, projectId: string, message = `project ${projectId} not found`): void {
    const project = this.collections.getById(projectId)
    if (project === undefined || project.workspaceId !== workspaceId) throw new NotFoundError(message)
  }
}
