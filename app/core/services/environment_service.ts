import type { Environment } from "@shared/types/Environment"
import type { JsonValue } from "@shared/types/JsonValue"
import type { EnvironmentCreate, EnvironmentRepository, EnvironmentUpdate } from "../repositories"
import type { PermissionProvider } from "../auth/PermissionProvider"
import type { SyncProvider } from "../sync/SyncProvider"
import { recordEnvironmentTombstone, recordEnvironmentUpsert } from "../sync/cloud-mutations"
import { NotFoundError } from "../ipc/errors"
import { RESOURCE_ENVIRONMENTS } from "../auth/permissions"
import { authorizeWorkspace } from "./authorize"
import type { ScopeResolver } from "./scope_resolver"

/** Workspace-scoped environment CRUD + variable ops. Collapses Python `environment_service` + `scoped_environment_service`. */
export class EnvironmentService {
  constructor(
    private readonly environments: EnvironmentRepository,
    private readonly syncProvider: SyncProvider,
    private readonly permissions: PermissionProvider,
    private readonly scopeResolver: ScopeResolver,
  ) {}

  async create(workspaceId: string, input: Omit<EnvironmentCreate, "workspaceId">): Promise<Environment> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "create", RESOURCE_ENVIRONMENTS)
    const created = this.environments.create({ ...input, workspaceId })
    recordEnvironmentUpsert(this.syncProvider, created)
    await this.syncProvider.push()
    return created
  }

  async get(workspaceId: string, environmentId: string): Promise<Environment> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_ENVIRONMENTS)
    return this.mustGet(workspaceId, environmentId)
  }

  async list(workspaceId: string): Promise<{ items: readonly Environment[]; total: number }> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_ENVIRONMENTS)
    return this.environments.listByWorkspace(workspaceId)
  }

  async update(workspaceId: string, environmentId: string, patch: EnvironmentUpdate): Promise<Environment> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "update", RESOURCE_ENVIRONMENTS)
    this.mustGet(workspaceId, environmentId)
    const updated = this.environments.update(environmentId, patch)
    if (updated === undefined) throw new NotFoundError(`environment ${environmentId} not found`)
    recordEnvironmentUpsert(this.syncProvider, updated)
    await this.syncProvider.push()
    return updated
  }

  async delete(workspaceId: string, environmentId: string): Promise<void> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "delete", RESOURCE_ENVIRONMENTS)
    const existing = this.mustGet(workspaceId, environmentId)
    recordEnvironmentTombstone(this.syncProvider, existing)
    this.environments.delete(environmentId)
    await this.syncProvider.push()
  }

  async setVariable(
    workspaceId: string,
    environmentId: string,
    name: string,
    value: JsonValue,
  ): Promise<Environment> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "update", RESOURCE_ENVIRONMENTS)
    this.mustGet(workspaceId, environmentId)
    const updated = this.environments.setVariable(environmentId, name, value)
    if (updated === undefined) throw new NotFoundError(`environment ${environmentId} not found`)
    recordEnvironmentUpsert(this.syncProvider, updated)
    await this.syncProvider.push()
    return updated
  }

  async deleteVariable(workspaceId: string, environmentId: string, name: string): Promise<Environment> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "update", RESOURCE_ENVIRONMENTS)
    this.mustGet(workspaceId, environmentId)
    const updated = this.environments.deleteVariable(environmentId, name)
    if (updated === undefined) throw new NotFoundError(`environment ${environmentId} not found`)
    recordEnvironmentUpsert(this.syncProvider, updated)
    await this.syncProvider.push()
    return updated
  }

  private mustGet(workspaceId: string, environmentId: string): Environment {
    const environment = this.environments.getById(environmentId)
    if (environment === undefined || environment.workspaceId !== workspaceId) {
      throw new NotFoundError(`environment ${environmentId} not found`)
    }
    return environment
  }
}
