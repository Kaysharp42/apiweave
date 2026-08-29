import type { Environment } from "@shared/types/Environment"
import type { JsonValue } from "@shared/types/JsonValue"
import type {
  EnvironmentCreate,
  EnvironmentRepository,
  EnvironmentUpdate,
  SecretRepository,
  WorkflowRepository,
} from "../repositories"
import type { PermissionProvider } from "../auth/PermissionProvider"
import type { SyncProvider } from "../sync/SyncProvider"
import {
  recordEnvironmentTombstone,
  recordEnvironmentUpsert,
  recordWorkflowUpsert,
} from "../sync/cloud-mutations"
import { NotFoundError, ValidationError } from "../ipc/errors"
import { RESOURCE_ENVIRONMENTS } from "../auth/permissions"
import { authorizeWorkspace } from "./authorize"
import type { ScopeResolver } from "./scope_resolver"

const MAX_BASE_ENVIRONMENT_CHAIN_DEPTH = 8

/** Workspace-scoped environment CRUD + variable ops. Collapses Python `environment_service` + `scoped_environment_service`. */
export class EnvironmentService {
  // fallow-ignore-next-line code-duplication -- constructor DI boilerplate that mirrors the sibling services (collection, workflow, run) by construction; the dependencies are different repositories and there is no behaviour here to extract
  constructor(
    private readonly environments: EnvironmentRepository,
    private readonly syncProvider: SyncProvider,
    private readonly permissions: PermissionProvider,
    private readonly scopeResolver: ScopeResolver,
    // Optional so the existing single-argument-set construction in tests keeps
    // working. When absent, `detachReferences` degrades to clearing only the
    // sibling environments it can see, which is what a caller without a
    // workflow repository could have done anyway.
    private readonly workflows?: WorkflowRepository,
    private readonly secrets?: SecretRepository,
  ) {}

  async create(workspaceId: string, input: Omit<EnvironmentCreate, "workspaceId">): Promise<Environment> {
    await this.authorize(workspaceId, "create")
    if (input.baseEnvironmentId) {
      this.validateBaseEnvironment(workspaceId, undefined, input.baseEnvironmentId)
    }
    return this.pushUpsert(this.environments.create({ ...input, workspaceId }))
  }

  async get(workspaceId: string, environmentId: string): Promise<Environment> {
    await this.authorize(workspaceId, "read")
    return this.mustGet(workspaceId, environmentId)
  }

  async list(workspaceId: string): Promise<{ items: readonly Environment[]; total: number }> {
    await this.authorize(workspaceId, "read")
    return this.environments.listByWorkspace(workspaceId)
  }

  async update(workspaceId: string, environmentId: string, patch: EnvironmentUpdate): Promise<Environment> {
    await this.authorize(workspaceId, "update")
    this.mustGet(workspaceId, environmentId)
    if (patch.baseEnvironmentId) {
      this.validateBaseEnvironment(workspaceId, environmentId, patch.baseEnvironmentId)
    }
    return this.pushUpsert(this.requireUpdated(this.environments.update(environmentId, patch), environmentId))
  }

  async delete(workspaceId: string, environmentId: string): Promise<void> {
    await this.authorize(workspaceId, "delete")
    const existing = this.mustGet(workspaceId, environmentId)
    recordEnvironmentTombstone(this.syncProvider, existing)
    const detached = this.environments.transaction(() => {
      const cleared = this.detachReferences(workspaceId, environmentId)
      this.environments.delete(environmentId)
      return cleared
    })
    this.recordDetached(detached)
    await this.syncProvider.push()
  }

  /**
   * Copy an environment, optionally into a different workspace.
   *
   * What does NOT come along:
   * - `isDefault`, always. A workspace's default is a single choice and a copy
   *   has no claim on it; a cross-workspace copy has even less.
   * - `baseEnvironmentId`, on a cross-workspace copy. A base must live in the
   *   same workspace (`validateBaseEnvironment`), so a link to the source's base
   *   would be unsaveable at the destination on the very next edit.
   * - secrets. See {@link EnvironmentService} note below.
   *
   * ponytail: secrets are not copied. The sealed bytes would open fine (the
   * sealed-box seed is machine-wide, not per scope), but re-attaching one scope's
   * ciphertext under another scope id is a security decision, not a convenience —
   * and across workspaces it silently widens who can run with that value. Callers
   * warn the user which environment-scoped secrets they must re-enter. Copy them
   * here only behind an explicit opt-in.
   */
  async duplicate(
    workspaceId: string,
    environmentId: string,
    targetWorkspaceId?: string,
    name?: string,
  ): Promise<Environment> {
    await this.authorize(workspaceId, "read")
    const destination = targetWorkspaceId ?? workspaceId
    await this.authorize(destination, "create")
    const source = this.mustGet(workspaceId, environmentId)

    const sameWorkspace = destination === workspaceId
    const created = this.environments.create({
      workspaceId: destination,
      name: name?.trim() || `${source.name} (copy)`,
      description: source.description,
      swaggerDocUrl: source.swaggerDocUrl,
      baseEnvironmentId: sameWorkspace ? source.baseEnvironmentId : null,
      variables: { ...source.variables },
      secrets: {},
      isDefault: false,
    })
    return this.pushUpsert(created)
  }

  /**
   * Move an environment into another workspace.
   *
   * A workspace is the scope an environment resolves in, so everything pointing
   * at this one from the workspace it leaves is cleared here rather than left for
   * the next save to trip over — the same trade `WorkflowService.moveToWorkspace`
   * makes. That is: workflows that selected it, sibling environments that extend
   * it, its own base environment, and its claim on being the workspace default.
   * Telling the user which of those they are about to lose is the caller's job;
   * this method does not refuse the move over them.
   *
   * Environment-scoped secrets DO come along — re-homed onto the destination
   * workspace. They are not a reference that can be re-picked: `workspace_id` is
   * the FK that ON DELETE CASCADE follows, so leaving them behind would destroy
   * them the day the source workspace is deleted.
   */
  async moveToWorkspace(
    workspaceId: string,
    environmentId: string,
    targetWorkspaceId: string,
  ): Promise<Environment> {
    await this.authorize(workspaceId, "update")
    await this.authorize(targetWorkspaceId, "create")
    const existing = this.mustGet(workspaceId, environmentId)
    if (targetWorkspaceId === workspaceId) {
      throw new ValidationError("environment is already in this workspace")
    }

    // The outbox is keyed by workspace (`core/sync/cloud-mutations`), so a lone
    // upsert under the destination would leave the source workspace still
    // claiming the row. Leaving is a deletion from where it left.
    recordEnvironmentTombstone(this.syncProvider, existing)

    const { moved, detached } = this.environments.transaction(() => {
      const cleared = this.detachReferences(workspaceId, environmentId)
      this.environments.update(environmentId, { baseEnvironmentId: null, isDefault: false })
      this.environments.setWorkspace(environmentId, targetWorkspaceId)
      this.secrets?.reassignWorkspace("environment", environmentId, targetWorkspaceId)
      return { moved: this.environments.getById(environmentId), detached: cleared }
    })

    this.recordDetached(detached)
    return this.pushUpsert(this.requireUpdated(moved, environmentId))
  }

  async setVariable(
    workspaceId: string,
    environmentId: string,
    name: string,
    value: JsonValue,
  ): Promise<Environment> {
    return this.applyVariable(workspaceId, environmentId, name, (id, variableName) =>
      this.environments.setVariable(id, variableName, value),
    )
  }

  async deleteVariable(workspaceId: string, environmentId: string, name: string): Promise<Environment> {
    return this.applyVariable(workspaceId, environmentId, name, (id, variableName) =>
      this.environments.deleteVariable(id, variableName),
    )
  }

  /**
   * The shared shape of the two variable writes: authorize, require the
   * environment, apply the write, then queue the upsert and push.
   */
  private async applyVariable(
    workspaceId: string,
    environmentId: string,
    name: string,
    write: (environmentId: string, name: string) => Environment | undefined,
  ): Promise<Environment> {
    await this.authorize(workspaceId, "update")
    this.mustGet(workspaceId, environmentId)
    return this.pushUpsert(this.requireUpdated(write(environmentId, name), environmentId))
  }

  /**
   * The two-step gate every entry point here runs first, narrowed to this
   * service's resource so call sites name only the action.
   */
  private async authorize(workspaceId: string, action: "read" | "create" | "update" | "delete"): Promise<void> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, action, RESOURCE_ENVIRONMENTS)
  }

  /** Queue the sync upsert for a written row, push the outbox, hand the row back. */
  private async pushUpsert(environment: Environment): Promise<Environment> {
    recordEnvironmentUpsert(this.syncProvider, environment)
    await this.syncProvider.push()
    return environment
  }

  /** A repository write that answers `Environment | undefined` becomes the row, or a 404. */
  private requireUpdated(updated: Environment | undefined, environmentId: string): Environment {
    if (updated === undefined) throw new NotFoundError(`environment ${environmentId} not found`)
    return updated
  }

  /**
   * Clear every reference to `environmentId` from within `workspaceId`, and
   * report what changed so the caller can record the sync upserts.
   *
   * Both callers — delete and cross-workspace move — leave the same dangling
   * references behind, so the guard lives here once rather than in each. A
   * workflow whose `selectedEnvironmentId` names a gone environment fails at run
   * time with a resolution error the user cannot act on; a sibling environment
   * whose `baseEnvironmentId` does is rejected by `validateBaseEnvironment` on
   * its next ordinary edit.
   *
   * Must run inside the caller's transaction, and BEFORE the environment leaves
   * the workspace — it reads the source workspace's rows to find the referrers.
   */
  private detachReferences(
    workspaceId: string,
    environmentId: string,
  ): { workflowIds: readonly string[]; environmentIds: readonly string[] } {
    const workflowIds: string[] = []
    for (const workflow of this.workflows?.listByWorkspace(workspaceId, true).items ?? []) {
      if (workflow.selectedEnvironmentId !== environmentId) continue
      this.workflows?.update(workflow.workflowId, { selectedEnvironmentId: null })
      workflowIds.push(workflow.workflowId)
    }

    // `baseEnvironmentId` lives in settings_json, so the filter runs in JS after
    // an indexed workspace_id fetch — fine at desktop scale (a workspace holds a
    // handful of environments).
    const environmentIds: string[] = []
    for (const sibling of this.environments.listByWorkspace(workspaceId).items) {
      if (sibling.environmentId === environmentId || sibling.baseEnvironmentId !== environmentId) continue
      this.environments.update(sibling.environmentId, { baseEnvironmentId: null })
      environmentIds.push(sibling.environmentId)
    }

    return { workflowIds, environmentIds }
  }

  /** Queue sync upserts for the rows {@link detachReferences} rewrote. */
  private recordDetached(detached: {
    workflowIds: readonly string[]
    environmentIds: readonly string[]
  }): void {
    for (const workflowId of detached.workflowIds) {
      const workflow = this.workflows?.getById(workflowId)
      if (workflow !== undefined) recordWorkflowUpsert(this.syncProvider, workflow)
    }
    for (const siblingId of detached.environmentIds) {
      const sibling = this.environments.getById(siblingId)
      if (sibling !== undefined) recordEnvironmentUpsert(this.syncProvider, sibling)
    }
  }

  private mustGet(workspaceId: string, environmentId: string): Environment {
    const environment = this.environments.getById(environmentId)
    if (environment?.workspaceId !== workspaceId) {
      throw new NotFoundError(`environment ${environmentId} not found`)
    }
    return environment
  }

  /**
   * Guards a `baseEnvironmentId` write: the base must exist in the same
   * workspace, an environment can't extend itself, and it can't extend an
   * environment that (directly or transitively) already extends it — a cycle
   * would make `resolveEffectiveVariables` depth-cap out instead of erroring
   * clearly at write time.
   */
  private validateBaseEnvironment(
    workspaceId: string,
    environmentId: string | undefined,
    baseEnvironmentId: string,
  ): void {
    if (environmentId !== undefined && baseEnvironmentId === environmentId) {
      throw new ValidationError("an environment cannot extend itself")
    }
    const base = this.environments.getById(baseEnvironmentId)
    if (base?.workspaceId !== workspaceId) {
      throw new ValidationError(`base environment ${baseEnvironmentId} not found in workspace`)
    }
    if (environmentId === undefined) {
      return
    }
    let current: Environment | undefined = base
    const seen = new Set<string>()
    while (current !== undefined && !seen.has(current.environmentId) && seen.size < MAX_BASE_ENVIRONMENT_CHAIN_DEPTH) {
      if (current.environmentId === environmentId) {
        throw new ValidationError("base environment chain would create a cycle")
      }
      seen.add(current.environmentId)
      current = current.baseEnvironmentId ? this.environments.getById(current.baseEnvironmentId) : undefined
    }
  }
}
