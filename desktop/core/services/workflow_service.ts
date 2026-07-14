import type { Workflow } from "../../../shared/types/Workflow"
import type {
  CollectionRepository,
  EnvironmentRepository,
  WorkflowCreate,
  WorkflowRepository,
  WorkflowUpdate,
} from "../repositories"
import type { PermissionProvider } from "../auth/PermissionProvider"
import type { SyncProvider } from "../sync/SyncProvider"
import { recordWorkflowTombstone, recordWorkflowUpsert } from "../sync/cloud-mutations"
import { NotFoundError } from "../ipc/errors"
import { RESOURCE_WORKFLOWS } from "../auth/permissions"
import { authorizeWorkspace } from "./authorize"
import type { ScopeResolver } from "./scope_resolver"

/** Workspace-scoped workflow CRUD. Collapses Python `workflow_service` + `scoped_workflow_service`. */
export class WorkflowService {
  constructor(
    private readonly workflows: WorkflowRepository,
    private readonly syncProvider: SyncProvider,
    private readonly permissions: PermissionProvider,
    private readonly scopeResolver: ScopeResolver,
    private readonly collections?: CollectionRepository,
    private readonly environments?: EnvironmentRepository,
  ) {}

  async create(workspaceId: string, input: Omit<WorkflowCreate, "workspaceId">): Promise<Workflow> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "create", RESOURCE_WORKFLOWS)
    const created = this.workflows.create({ ...input, workspaceId })
    recordWorkflowUpsert(this.syncProvider, created)
    await this.syncProvider.push()
    return created
  }

  async get(workspaceId: string, workflowId: string): Promise<Workflow> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_WORKFLOWS)
    return this.mustGet(workspaceId, workflowId)
  }

  async list(
    workspaceId: string,
    includeAttached = false,
  ): Promise<{ items: readonly Workflow[]; total: number }> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_WORKFLOWS)
    return this.workflows.listByWorkspace(workspaceId, includeAttached)
  }

  async update(workspaceId: string, workflowId: string, patch: WorkflowUpdate): Promise<Workflow> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "update", RESOURCE_WORKFLOWS)
    this.mustGet(workspaceId, workflowId)
    const updated = this.workflows.update(workflowId, patch)
    if (updated === undefined) throw new NotFoundError(`workflow ${workflowId} not found`)
    recordWorkflowUpsert(this.syncProvider, updated)
    await this.syncProvider.push()
    return updated
  }

  async delete(workspaceId: string, workflowId: string): Promise<void> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "delete", RESOURCE_WORKFLOWS)
    const existing = this.mustGet(workspaceId, workflowId)
    recordWorkflowTombstone(this.syncProvider, existing)
    this.workflows.delete(workflowId)
    await this.syncProvider.push()
  }

  /** Attach/detach a workflow to a collection (project). `collectionId=null` detaches. */
  async attachToCollection(
    workspaceId: string,
    workflowId: string,
    collectionId: string | null,
  ): Promise<Workflow> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "update", RESOURCE_WORKFLOWS)
    this.mustGet(workspaceId, workflowId)
    if (collectionId !== null) {
      const collection = this.collections?.getById(collectionId)
      if (!collection || collection.workspaceId !== workspaceId) {
        throw new NotFoundError(`collection ${collectionId} not found`)
      }
    }
    const updated = this.workflows.update(workflowId, { collectionId })
    if (updated === undefined) throw new NotFoundError(`workflow ${workflowId} not found`)
    recordWorkflowUpsert(this.syncProvider, updated)
    await this.syncProvider.push()
    return updated
  }

  /** Set/clear the workflow's selected environment. `environmentId=null` clears it. */
  async setEnvironment(
    workspaceId: string,
    workflowId: string,
    environmentId: string | null,
  ): Promise<Workflow> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "update", RESOURCE_WORKFLOWS)
    this.mustGet(workspaceId, workflowId)
    if (environmentId !== null) {
      const env = this.environments?.getById(environmentId)
      if (!env || env.workspaceId !== workspaceId) {
        throw new NotFoundError(`environment ${environmentId} not found`)
      }
    }
    const updated = this.workflows.update(workflowId, { selectedEnvironmentId: environmentId })
    if (updated === undefined) throw new NotFoundError(`workflow ${workflowId} not found`)
    recordWorkflowUpsert(this.syncProvider, updated)
    await this.syncProvider.push()
    return updated
  }

  /** Existence-hiding read: a workflow outside `workspaceId` is reported as absent. */
  private mustGet(workspaceId: string, workflowId: string): Workflow {
    const workflow = this.workflows.getByIdInWorkspace(workflowId, workspaceId)
    if (workflow === undefined) throw new NotFoundError(`workflow ${workflowId} not found`)
    return workflow
  }
}
