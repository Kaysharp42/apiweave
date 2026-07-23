import { createHash } from "node:crypto"
import type { PermissionProvider } from "../auth/PermissionProvider"
import type { SyncProvider } from "../sync/SyncProvider"
import { NotFoundError } from "../ipc/errors"
import { RESOURCE_SECRETS } from "../auth/permissions"
import {
  ScopedSecretResolver,
  type ResolvedSecret,
  type SecretMetadata,
  type SecretScopeChain,
  type SecretScopeType,
} from "../secrets/scoped_secret_resolver"
import { ALGORITHM, openSealedBox, publicKeyFromSeed } from "../secrets/sealed_box"
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
export interface SecretPublicKey {
  readonly keyId: string
  readonly publicKey: string
  readonly algorithm: typeof ALGORITHM
}

/** Narrow seam for checking that an environment scope belongs to a workspace. */
export interface EnvironmentOwnershipLookup {
  getById(environmentId: string): { readonly workspaceId: string } | undefined
}

export class SecretService {
  private readonly resolver: ScopedSecretResolver
  // ponytail: seed MUST derive from the persisted keyfile master KEK, never randomBytes —
  // the renderer seals against publicKeyFromSeed(this seed). randomBytes regenerates every
  // restart and can't open any box sealed in a prior session. Mirrors Python sha256(SECRET_ENCRYPTION_KEY).
  private readonly sealedBoxSeed: Uint8Array

  constructor(
    private readonly store: SecretWriteStore,
    private readonly syncProvider: SyncProvider,
    private readonly permissions: PermissionProvider,
    private readonly scopeResolver: ScopeResolver,
    private readonly environments: EnvironmentOwnershipLookup,
    masterKek: Uint8Array,
  ) {
    this.resolver = new ScopedSecretResolver(store)
    this.sealedBoxSeed = createHash("sha256").update(masterKek).digest()
  }

  /**
   * Reject scope IDs that don't belong to the caller's authorized workspace.
   * `authorizeWorkspace` only checks the outer `workspaceId` param — every
   * scopeId/chain entry passed alongside it must be bound here, or a caller
   * authorized for one workspace can read/write another's secret metadata by
   * naming a foreign scopeId.
   */
  private assertScopeInWorkspace(scopeType: SecretScopeType, scopeId: string, workspaceId: string): void {
    if (scopeType === "workspace") {
      if (scopeId !== workspaceId) throw new NotFoundError(`workspace ${scopeId} not found`)
      return
    }
    const environment = this.environments.getById(scopeId)
    if (!environment || environment.workspaceId !== workspaceId) {
      throw new NotFoundError(`environment ${scopeId} not found`)
    }
  }

  async publicKey(
    workspaceId: string,
    scopeType: SecretScopeType,
    scopeId: string,
  ): Promise<SecretPublicKey> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_SECRETS)
    const keyId = `sealed-box:${scopeType}:${scopeId}`
    const publicKey = await publicKeyFromSeed(this.sealedBoxSeed)
    return { keyId, publicKey: Buffer.from(publicKey).toString("base64"), algorithm: ALGORITHM }
  }

  /** Store (or overwrite) a sealed secret under `workspaceId`. Returns metadata only. */
  async set(workspaceId: string, input: Omit<SecretUpsert, "workspaceId">): Promise<SecretMetadata> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "create", RESOURCE_SECRETS)
    this.assertScopeInWorkspace(input.scopeType, input.scopeId, workspaceId)
    const metadata = await this.store.put({ ...input, workspaceId })
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
    this.assertScopeInWorkspace(scopeType, scopeId, workspaceId)
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
    this.assertScopeInWorkspace(scopeType, scopeId, workspaceId)
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
    if (chain.workspaceId !== undefined) this.assertScopeInWorkspace("workspace", chain.workspaceId, workspaceId)
    if (chain.environmentId !== undefined) this.assertScopeInWorkspace("environment", chain.environmentId, workspaceId)
    return this.resolver.resolve(chain, name)
  }

  /**
   * Trusted runtime resolution: walk the env > workspace chain, open the winning
   * sealed box, and return the plaintext. Returns null if the name is unset in
   * every scope. The only path that yields a secret's plaintext; the value stays
   * in the executor's runtime scope and is masked before any result is persisted.
   */
  async resolvePlaintext(
    name: string,
    chain: SecretScopeChain,
  ): Promise<string | null> {
    const hit = await this.resolver.resolve(chain, name)
    if (!hit) return null
    const ciphertext = await this.store.getCiphertext(hit.resolvedScope, hit.metadata.scopeId, name)
    if (!ciphertext) return null
    return openSealedBox(ciphertext, this.sealedBoxSeed)
  }
}
