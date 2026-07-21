/**
 * Scoped secret resolution — the override chain ported from
 * `backend/app/services/secret_service.py::resolve_effective_secret`.
 *
 * Precedence (most specific wins): environment > workspace. Organization is
 * dropped in the desktop single-user model (decision #12).
 *
 * `resolve(...)` returns METADATA ONLY — never a ciphertext or plaintext. Secrets
 * are write-only; the masked display and listing paths go through here. The
 * trusted runtime substitution (opening a sealed box) is a separate path in the
 * executor, not this resolver.
 */

export type SecretScopeType = "environment" | "workspace"

/** Metadata for one stored secret. Deliberately carries NO secret material. */
export interface SecretMetadata {
  readonly secretId: string
  readonly name: string
  readonly scopeType: SecretScopeType
  readonly scopeId: string
  readonly keyId: string
  readonly label?: string
}

/** The scope chain to resolve against — a request may name an environment, a workspace, or both. */
export interface SecretScopeChain {
  readonly environmentId?: string
  readonly workspaceId?: string
}

/** A resolved secret: its metadata plus which scope in the chain won. */
export interface ResolvedSecret {
  readonly metadata: SecretMetadata
  readonly resolvedScope: SecretScopeType
}

/**
 * The metadata lookup seam. Repositories (Task 6) implement this against SQLite;
 * tests pass a fake. Returns metadata only — implementations must never expose
 * ciphertext or plaintext here.
 */
export interface SecretMetadataStore {
  getByScopeAndName(
    scopeType: SecretScopeType,
    scopeId: string,
    name: string,
  ): SecretMetadata | null | Promise<SecretMetadata | null>
}

export class ScopedSecretResolver {
  constructor(private readonly store: SecretMetadataStore) {}

  /**
   * Resolve the effective secret for `name` down the scope chain. Returns the
   * winning metadata (environment overrides workspace) or `null` if unset in
   * every scope. Never returns secret material.
   */
  async resolve(chain: SecretScopeChain, name: string): Promise<ResolvedSecret | null> {
    if (chain.environmentId) {
      const hit = await this.store.getByScopeAndName("environment", chain.environmentId, name)
      if (hit) return { metadata: hit, resolvedScope: "environment" }
    }
    if (chain.workspaceId) {
      const hit = await this.store.getByScopeAndName("workspace", chain.workspaceId, name)
      if (hit) return { metadata: hit, resolvedScope: "workspace" }
    }
    return null
  }
}
