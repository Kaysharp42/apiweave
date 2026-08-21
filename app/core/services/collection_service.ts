import type { Collection } from "@shared/types/Collection"
import type { Workflow } from "@shared/types/Workflow"
import type {
  CollectionCreate,
  CollectionRepository,
  CollectionUpdate,
  WorkflowRepository,
} from "../repositories"
import type { PermissionProvider } from "../auth/PermissionProvider"
import type { SyncProvider } from "../sync/SyncProvider"
import {
  recordCollectionTombstone,
  recordCollectionUpsert,
  recordWorkflowTombstone,
  recordWorkflowUpsert,
} from "../sync/cloud-mutations"
import { ConflictError, NotFoundError, ValidationError } from "../ipc/errors"
import { RESOURCE_COLLECTIONS } from "../auth/permissions"
import { authorizeWorkspace } from "./authorize"
import { clearDepartingCallTargets } from "./workspace_move"
import type { ScopeResolver } from "./scope_resolver"

/**
 * Workspace-scoped collection CRUD + workflow membership. Collapses Python
 * `collection_service` and `project_service` — "project" and "collection" are the
 * same aggregate here (the repo carries a `projectId` field). `workflowCount` is
 * always recomputed from the workflow table, never trusted from the stored column.
 */
export class CollectionService {
  constructor(
    private readonly collections: CollectionRepository,
    private readonly workflows: WorkflowRepository,
    private readonly syncProvider: SyncProvider,
    private readonly permissions: PermissionProvider,
    private readonly scopeResolver: ScopeResolver,
  ) {}

  async create(workspaceId: string, input: Omit<CollectionCreate, "workspaceId">): Promise<Collection> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "create", RESOURCE_COLLECTIONS)
    const created = this.collections.create({ ...input, workspaceId })
    recordCollectionUpsert(this.syncProvider, this.withCount(created))
    await this.syncProvider.push()
    return created
  }

  async get(workspaceId: string, collectionId: string): Promise<Collection> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_COLLECTIONS)
    return this.withCount(this.mustGet(workspaceId, collectionId))
  }

  async list(workspaceId: string): Promise<{ items: readonly Collection[]; total: number }> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_COLLECTIONS)
    const { items, total } = this.collections.listByWorkspace(workspaceId)
    return { items: items.map((collection) => this.withCount(collection)), total }
  }

  async update(workspaceId: string, collectionId: string, patch: CollectionUpdate): Promise<Collection> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "update", RESOURCE_COLLECTIONS)
    this.mustGet(workspaceId, collectionId)
    const updated = this.collections.update(collectionId, patch)
    if (updated === undefined) throw new NotFoundError(`collection ${collectionId} not found`)
    recordCollectionUpsert(this.syncProvider, this.withCount(updated))
    await this.syncProvider.push()
    return this.withCount(updated)
  }

  /** Delete a collection. Refuses (409) while any workflow is still attached. */
  async delete(workspaceId: string, collectionId: string): Promise<void> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "delete", RESOURCE_COLLECTIONS)
    const existing = this.mustGet(workspaceId, collectionId)
    const count = this.workflows.countByCollection(workspaceId, collectionId)
    if (count > 0) {
      throw new ConflictError(`Cannot delete collection. ${count} workflow(s) are still in it.`)
    }
    recordCollectionTombstone(this.syncProvider, this.withCount(existing))
    this.collections.delete(collectionId)
    await this.syncProvider.push()
  }

  /**
   * Move a project — and every workflow in it — into another workspace.
   *
   * The members are not optional cargo: a project whose workflows stayed behind
   * would leave every one of them pointing at a `collectionId` in a workspace
   * they are no longer in, which `assertCollectionInWorkspace` rejects on their
   * next save. What does NOT come along is each workflow's selected environment,
   * since an environment belongs to the workspace being left. Calls *between*
   * workflows in this project survive; calls out to a workflow left behind are
   * cleared (see {@link clearDepartingCallTargets}).
   */
  async moveToWorkspace(
    workspaceId: string,
    collectionId: string,
    targetWorkspaceId: string,
  ): Promise<Collection> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "update", RESOURCE_COLLECTIONS)
    await authorizeWorkspace(this.scopeResolver, this.permissions, targetWorkspaceId, "create", RESOURCE_COLLECTIONS)
    const existing = this.mustGet(workspaceId, collectionId)
    if (targetWorkspaceId === workspaceId) {
      throw new ValidationError("project is already in this workspace")
    }

    const members = this.workflows.listByCollection(workspaceId, collectionId).items
    const movingWorkflowIds = new Set(members.map((workflow) => workflow.workflowId))

    // Keyed by workspace, so leaving reads as a deletion from the source — see
    // the matching note in `WorkflowService.moveToWorkspace`.
    recordCollectionTombstone(this.syncProvider, this.withCount(existing))
    for (const member of members) recordWorkflowTombstone(this.syncProvider, member)

    const moved = this.collections.transaction(() => {
      this.collections.setWorkspace(collectionId, targetWorkspaceId)
      for (const member of members) {
        this.workflows.setWorkspace(member.workflowId, targetWorkspaceId)
        this.workflows.update(member.workflowId, {
          selectedEnvironmentId: null,
          nodes: clearDepartingCallTargets(member.nodes, movingWorkflowIds),
        })
      }
      return this.collections.getById(collectionId)
    })
    if (moved === undefined) throw new NotFoundError(`collection ${collectionId} not found`)

    const withCount = this.withCount(moved)
    recordCollectionUpsert(this.syncProvider, withCount)
    for (const member of members) {
      const relocated = this.workflows.getById(member.workflowId)
      if (relocated !== undefined) recordWorkflowUpsert(this.syncProvider, relocated)
    }
    await this.syncProvider.push()
    return withCount
  }

  async addWorkflow(workspaceId: string, collectionId: string, workflowId: string): Promise<Workflow> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "update", RESOURCE_COLLECTIONS)
    this.mustGet(workspaceId, collectionId)
    this.mustGetWorkflow(workspaceId, workflowId)
    const updated = this.workflows.update(workflowId, { collectionId })
    if (updated === undefined) throw new NotFoundError(`workflow ${workflowId} not found`)
    recordWorkflowUpsert(this.syncProvider, updated)
    await this.syncProvider.push()
    return updated
  }

  async removeWorkflow(workspaceId: string, collectionId: string, workflowId: string): Promise<Workflow> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "update", RESOURCE_COLLECTIONS)
    this.mustGet(workspaceId, collectionId)
    const workflow = this.mustGetWorkflow(workspaceId, workflowId)
    if (workflow.collectionId !== collectionId) {
      throw new NotFoundError(`workflow ${workflowId} is not in collection ${collectionId}`)
    }
    const updated = this.workflows.update(workflowId, { collectionId: null })
    if (updated === undefined) throw new NotFoundError(`workflow ${workflowId} not found`)
    recordWorkflowUpsert(this.syncProvider, updated)
    await this.syncProvider.push()
    return updated
  }

  async listWorkflows(workspaceId: string, collectionId: string): Promise<readonly Workflow[]> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_COLLECTIONS)
    this.mustGet(workspaceId, collectionId)
    return this.workflows.listByCollection(workspaceId, collectionId).items
  }

  private withCount(collection: Collection): Collection {
    return {
      ...collection,
      workflowCount: this.workflows.countByCollection(collection.workspaceId, collection.collectionId),
    }
  }

  private mustGet(workspaceId: string, collectionId: string): Collection {
    const collection = this.collections.getById(collectionId)
    if (collection === undefined || collection.workspaceId !== workspaceId) {
      throw new NotFoundError(`collection ${collectionId} not found`)
    }
    return collection
  }

  private mustGetWorkflow(workspaceId: string, workflowId: string): Workflow {
    const workflow = this.workflows.getByIdInWorkspace(workflowId, workspaceId)
    if (workflow === undefined) throw new NotFoundError(`workflow ${workflowId} not found`)
    return workflow
  }
}
