import type { Collection } from "@shared/types/Collection"
import type { Workflow } from "@shared/types/Workflow"
import type {
  CollectionCreate,
  CollectionRepository,
  CollectionUpdate,
  WorkflowRepository,
} from "../repositories"
import { ConflictError, NotFoundError, ValidationError } from "../ipc/errors"
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
    private readonly scopeResolver: ScopeResolver,
  ) {}

  async create(workspaceId: string, input: Omit<CollectionCreate, "workspaceId" | "collectionId">): Promise<Collection> {
    await this.scopeResolver.assertWorkspaceVisible(workspaceId)
    return this.collections.create({ ...input, workspaceId })
  }

  async get(workspaceId: string, collectionId: string): Promise<Collection> {
    await this.scopeResolver.assertWorkspaceVisible(workspaceId)
    return this.withCount(this.mustGet(workspaceId, collectionId))
  }

  async list(workspaceId: string): Promise<{ items: readonly Collection[]; total: number }> {
    await this.scopeResolver.assertWorkspaceVisible(workspaceId)
    const { items, total } = this.collections.listByWorkspace(workspaceId)
    return { items: items.map((collection) => this.withCount(collection)), total }
  }

  async update(workspaceId: string, collectionId: string, patch: CollectionUpdate): Promise<Collection> {
    await this.scopeResolver.assertWorkspaceVisible(workspaceId)
    this.mustGet(workspaceId, collectionId)
    const updated = this.collections.update(collectionId, patch)
    if (updated === undefined) throw new NotFoundError(`collection ${collectionId} not found`)
    return this.withCount(updated)
  }

  /** Delete a collection. Refuses (409) while any workflow is still attached. */
  async delete(workspaceId: string, collectionId: string): Promise<void> {
    await this.scopeResolver.assertWorkspaceVisible(workspaceId)
    this.mustGet(workspaceId, collectionId)
    const count = this.workflows.countByCollection(workspaceId, collectionId)
    if (count > 0) {
      throw new ConflictError(`Cannot delete collection. ${count} workflow(s) are still in it.`)
    }
    this.collections.delete(collectionId)
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
    await this.scopeResolver.assertWorkspaceVisible(workspaceId)
    await this.scopeResolver.assertWorkspaceVisible(targetWorkspaceId)
    this.mustGet(workspaceId, collectionId)
    if (targetWorkspaceId === workspaceId) {
      throw new ValidationError("project is already in this workspace")
    }

    const members = this.workflows.listByCollection(workspaceId, collectionId).items
    const movingWorkflowIds = new Set(members.map((workflow) => workflow.workflowId))

    return this.collections.transaction(() => {
      this.collections.setWorkspace(collectionId, targetWorkspaceId)
      for (const member of members) {
        this.workflows.setWorkspace(member.workflowId, targetWorkspaceId)
        this.workflows.update(member.workflowId, {
          selectedEnvironmentId: null,
          nodes: clearDepartingCallTargets(member.nodes, movingWorkflowIds),
        })
      }
      const collection = this.collections.getById(collectionId)
      if (collection === undefined) throw new NotFoundError(`collection ${collectionId} not found`)
      return this.withCount(collection)
    })
  }

  async addWorkflow(workspaceId: string, collectionId: string, workflowId: string): Promise<Workflow> {
    await this.scopeResolver.assertWorkspaceVisible(workspaceId)
    this.mustGet(workspaceId, collectionId)
    this.mustGetWorkflow(workspaceId, workflowId)
    return this.updateWorkflow(workflowId, { collectionId })
  }

  async removeWorkflow(workspaceId: string, collectionId: string, workflowId: string): Promise<Workflow> {
    await this.scopeResolver.assertWorkspaceVisible(workspaceId)
    this.mustGet(workspaceId, collectionId)
    const workflow = this.mustGetWorkflow(workspaceId, workflowId)
    if (workflow.collectionId !== collectionId) {
      throw new NotFoundError(`workflow ${workflowId} is not in collection ${collectionId}`)
    }
    return this.updateWorkflow(workflowId, { collectionId: null })
  }

  async listWorkflows(workspaceId: string, collectionId: string): Promise<readonly Workflow[]> {
    await this.scopeResolver.assertWorkspaceVisible(workspaceId)
    this.mustGet(workspaceId, collectionId)
    return this.workflows.listByCollection(workspaceId, collectionId).items
  }

  private withCount(collection: Collection): Collection {
    return {
      ...collection,
      workflowCount: this.workflows.countByCollection(collection.workspaceId, collection.collectionId),
    }
  }

  private updateWorkflow(workflowId: string, patch: { readonly collectionId: string | null }): Workflow {
    const updated = this.workflows.update(workflowId, patch)
    if (updated === undefined) throw new NotFoundError(`workflow ${workflowId} not found`)
    return updated
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
