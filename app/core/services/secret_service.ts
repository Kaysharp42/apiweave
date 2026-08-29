import { createHash } from "node:crypto"
import type { PermissionProvider } from "../auth/PermissionProvider"
import type { SyncProvider } from "../sync/SyncProvider"
import { NotFoundError, ValidationError } from "../ipc/errors"
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

/**
 * Where a secret is being copied or moved to. `workspaceId` is the owning
 * workspace of the destination scope and is authorized separately from the
 * source's — for a `workspace` scope it equals `scopeId`, for an `environment`
 * scope it is the workspace that environment lives in.
 */
export interface SecretScopeTarget {
  readonly workspaceId: string
  readonly scopeType: SecretScopeType
  readonly scopeId: string
  /** Rename on the way over. Defaults to the source name. */
  readonly name?: string
}

/**
 * The `keyId` stamped on a secret stored under a scope. A LABEL, not a key: the
 * sealed box opens with the machine-wide seed (see the constructor), so this
 * records which scope the value was filed under and nothing more. Copies and
 * moves re-stamp it, or metadata would keep naming the scope the secret left.
 */
function scopeKeyId(scopeType: SecretScopeType, scopeId: string): string {
  return `sealed-box:${scopeType}:${scopeId}`
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
  /**
   * The two-step gate every entry point here runs first, narrowed to this
   * service's resource so call sites name only the action.
   */
  private async authorize(workspaceId: string, action: "read" | "create" | "update" | "delete"): Promise<void> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, action, RESOURCE_SECRETS)
  }

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
    await this.authorize(workspaceId, "read")
    const keyId = scopeKeyId(scopeType, scopeId)
    const publicKey = await publicKeyFromSeed(this.sealedBoxSeed)
    return { keyId, publicKey: Buffer.from(publicKey).toString("base64"), algorithm: ALGORITHM }
  }

  /** Store (or overwrite) a sealed secret under `workspaceId`. Returns metadata only. */
  async set(workspaceId: string, input: Omit<SecretUpsert, "workspaceId">): Promise<SecretMetadata> {
    await this.authorize(workspaceId, "create")
    this.assertScopeInWorkspace(input.scopeType, input.scopeId, workspaceId)
    return this.pushAndReturn(await this.store.put({ ...input, workspaceId }))
  }

  /** List secret metadata for a scope (never values). */
  async list(
    workspaceId: string,
    scopeType: SecretScopeType,
    scopeId: string,
  ): Promise<readonly SecretMetadata[]> {
    await this.authorize(workspaceId, "read")
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
    await this.authorize(workspaceId, "delete")
    this.assertScopeInWorkspace(scopeType, scopeId, workspaceId)
    if (!(await this.store.remove(scopeType, scopeId, name))) {
      throw new NotFoundError(`secret ${name} not found`)
    }
    await this.syncProvider.push()
  }

  /**
   * Copy a secret into another scope — another workspace, or an environment.
   *
   * The sealed bytes are carried over VERBATIM, which is the only way this can
   * work: re-sealing needs the plaintext, and nothing outside the executor is
   * allowed to hold it. That is safe because the sealed-box seed is machine-wide
   * (derived from the keyfile master KEK in the constructor, not from the scope),
   * so a box sealed under one scope opens under any other on this machine.
   *
   * Contrast `EnvironmentService.duplicate`, which deliberately leaves secrets
   * behind: there the copy is incidental, here moving the value IS the request.
   * Both ends are authorized, so this cannot reach a workspace the caller has no
   * create right on.
   */
  async duplicate(
    workspaceId: string,
    scopeType: SecretScopeType,
    scopeId: string,
    name: string,
    target: SecretScopeTarget,
  ): Promise<SecretMetadata> {
    return this.copyAcross(workspaceId, scopeType, scopeId, name, target, "read", false)
  }

  /**
   * Move a secret into another scope: the copy, then the source row.
   */
  // fallow-ignore-next-line code-duplication -- the public API is deliberately two same-shaped entry points (copy vs move) over one pipeline; the only difference is the source-scope action and whether the source row is removed, and the parallel shape is the contract callers see
  async moveToScope(
    workspaceId: string,
    scopeType: SecretScopeType,
    scopeId: string,
    name: string,
    target: SecretScopeTarget,
  ): Promise<SecretMetadata> {
    return this.copyAcross(workspaceId, scopeType, scopeId, name, target, "delete", true)
  }

  /**
   * The one copy pipeline `duplicate` and `moveToScope` differ on: the action
   * the caller needs on the SOURCE scope (a copy reads it, a move deletes from
   * it), and whether the source row is removed at the end.
   *
   * Copy-then-remove, never remove-then-copy. A failure between the two leaves
   * the secret in both scopes, which the user can see and clean up; the other
   * order loses a value that by construction nobody can retype from memory.
   */
  private async copyAcross(
    workspaceId: string,
    scopeType: SecretScopeType,
    scopeId: string,
    name: string,
    target: SecretScopeTarget,
    sourceAction: "read" | "delete",
    removeSource: boolean,
  ): Promise<SecretMetadata> {
    await this.authorize(workspaceId, sourceAction)
    const created = await this.copyInto(workspaceId, scopeType, scopeId, name, target)
    if (removeSource) {
      await this.store.remove(scopeType, scopeId, name)
    }
    return this.pushAndReturn(created)
  }

  /** Push the outbox, then hand the written row back. */
  private async pushAndReturn(metadata: SecretMetadata): Promise<SecretMetadata> {
    await this.syncProvider.push()
    return metadata
  }

  private async copyInto(
    workspaceId: string,
    scopeType: SecretScopeType,
    scopeId: string,
    name: string,
    target: SecretScopeTarget,
  ): Promise<SecretMetadata> {
    await this.authorize(target.workspaceId, "create")
    this.assertScopeInWorkspace(scopeType, scopeId, workspaceId)
    this.assertScopeInWorkspace(target.scopeType, target.scopeId, target.workspaceId)

    const source = await this.store.getByScopeAndName(scopeType, scopeId, name)
    if (!source) throw new NotFoundError(`secret ${name} not found`)

    const targetName = target.name?.trim() || name
    const sameScope = target.scopeType === scopeType && target.scopeId === scopeId
    if (sameScope && targetName === name) {
      throw new ValidationError("secret is already in this scope under that name")
    }
    // `put` upserts by (scope, key). Letting it through here would overwrite a
    // value nothing can read back, print, or undo — fail and let the user pick
    // another name instead.
    if (await this.store.getByScopeAndName(target.scopeType, target.scopeId, targetName)) {
      throw new ValidationError(`a secret named ${targetName} already exists in the destination scope`)
    }

    const sealed = await this.store.getCiphertext(scopeType, scopeId, name)
    if (sealed === null) throw new NotFoundError(`secret ${name} has no stored value`)

    return this.store.put({
      workspaceId: target.workspaceId,
      scopeType: target.scopeType,
      scopeId: target.scopeId,
      name: targetName,
      keyId: scopeKeyId(target.scopeType, target.scopeId),
      sealed,
      ...(source.label ? { label: source.label } : {}),
    })
  }

  /** Resolve which scope owns `name` down the environment > workspace chain. Metadata only. */
  async resolve(
    workspaceId: string,
    chain: SecretScopeChain,
    name: string,
  ): Promise<ResolvedSecret | null> {
    await this.authorize(workspaceId, "read")
    if (chain.workspaceId !== undefined) this.assertScopeInWorkspace("workspace", chain.workspaceId, workspaceId)
    if (chain.environmentId !== undefined) this.assertScopeInWorkspace("environment", chain.environmentId, workspaceId)
    return this.resolver.resolve(chain, name)
  }

  /**
   * Trusted runtime resolution: walk the env > workspace chain, open the winning
   * sealed box, and return the plaintext plus which scope won. Returns
   * `{ plaintext: null, scopeType: <scope|null> }` if the name is unset or has
   * no ciphertext. The only path that yields a secret's plaintext; the value
   * stays in the executor's runtime scope and is masked before any result is
   * persisted. The scope is safe (non-secret) metadata used for debug confidence.
   */
  async resolvePlaintext(
    name: string,
    chain: SecretScopeChain,
  ): Promise<{ plaintext: string | null; scopeType: SecretScopeType | null }> {
    const hit = await this.resolver.resolve(chain, name)
    if (!hit) return { plaintext: null, scopeType: null }
    const ciphertext = await this.store.getCiphertext(hit.resolvedScope, hit.metadata.scopeId, name)
    if (!ciphertext) return { plaintext: null, scopeType: hit.resolvedScope }
    return { plaintext: await openSealedBox(ciphertext, this.sealedBoxSeed), scopeType: hit.resolvedScope }
  }
}
