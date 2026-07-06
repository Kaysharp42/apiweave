import type { PermissionProvider } from "../auth/PermissionProvider"
import type { SyncProvider } from "../sync/SyncProvider"
import { NotFoundError } from "../ipc/errors"
import { RESOURCE_SECRETS } from "../auth/permissions"
import {
  ScopedSecretResolver,
  type ResolvedSecret,
  type SecretMetadata,
  type SecretMetadataStore,
  type SecretScopeChain,
  type SecretScopeType,
} from "../secrets/scoped_secret_resolver"
import type { SecretWriteStore, SecretUpsert } from "../secrets/SecretStore"
import { authorizeWorkspace } from "./authorize"
import type { ScopeResolver } from "./scope_resolver"

/**
 * Secret service surface — write-only at every layer. Ported from the local
 * subset of Python `secret_service`/`scoped_secrets` (org scope dropped, #12).
 *
 * Every method returns METADATA ONLY. There is no read-back path for a secret's
 * value: sealing happens client-side, and resolution during a run opens the sealed
 * box in the executor (Task 14), never here. `set` accepts already-sealed bytes.
 */
export class SecretService {
  private readonly resolver: ScopedSecretResolver

  constructor(
    private readonly store: SecretWriteStore,
    private readonly syncProvider: SyncProvider,
    private readonly permissions: PermissionProvider,
    private readonly scopeResolver: ScopeResolver,
  ) {
    this.resolver = new ScopedSecretResolver(store)
  }

  /** Store (or overwrite) a sealed secret under `workspaceId`. Returns metadata only. */
  async set(workspaceId: string, input: SecretUpsert): Promise<SecretMetadata> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "create", RESOURCE_SECRETS)
    const metadata = await this.store.put(input)
    await this.syncProvider.push()
    return metadata
  }

  /** List secret metadata for a scope (never values). */
  async list(
    workspaceId: string,
    scopeType: SecretScopeType,
    scopeId: string,
  ): Promise<readonly SecretMetadata[]> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_SECRETS)
    return this.store.listByScope(scopeType, scopeId)
  }

  /** Delete a secret by name within a scope. */
  async delete(
    workspaceId: string,
    scopeType: SecretScopeType,
    scopeId: string,
    name: string,
  ): Promise<void> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "delete", RESOURCE_SECRETS)
    const removed = await this.store.remove(scopeType, scopeId, name)
    if (!removed) throw new NotFoundError(`secret ${name} not found`)
    await this.syncProvider.push()
  }

  /** Resolve which scope owns `name` down the environment > workspace chain. Metadata only. */
  async resolve(
    workspaceId: string,
    chain: SecretScopeChain,
    name: string,
  ): Promise<ResolvedSecret | null> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_SECRETS)
    return this.resolver.resolve(chain, name)
  }
}
