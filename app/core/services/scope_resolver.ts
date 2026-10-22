import { NotFoundError } from "../ipc/errors"

/**
 * Stable id of the single synthetic local owner (mirrors the backend's
 * `SINGLE_USER_OWNER_ID`). In desktop single-user mode the `user` scope is
 * only ever the owner's own scope; any other user id is unknown.
 */
export const LOCAL_OWNER_ID = "usr-single-user-owner"

/**
 * Scope reference — what the service is operating on. The `scopeType` +
 * `scopeId` pair mirrors the Python `scope_resolver.py` contract.
 */
export interface ScopeRef {
  readonly scopeType: "user" | "workspace" | "environment"
  readonly scopeId: string
}

/**
 * Result of binding a `{ scopeType, scopeId }` pair to the local owner.
 *
 * Existence-hiding contract (ported from `backend/app/services/scope_resolver.py`):
 * a scope the caller can't see returns `not_found` — NEVER `denied`/`forbidden`.
 * Leaking `denied` for a non-existent scope would confirm its existence to an
 * enumerator.
 */
export type ScopeResolution =
  | { readonly ok: true; readonly scope: ScopeRef }
  | { readonly ok: false; readonly code: "not_found" }

/**
 * Existence source the resolver consults. In single-user mode the local owner
 * can see every scope that EXISTS, so visibility collapses to existence.
 * Repositories (Task 6) implement this against SQLite; tests pass a fake.
 */
export interface ScopeExistence {
  workspaceExists(workspaceId: string): boolean | Promise<boolean>
  environmentExists(environmentId: string): boolean | Promise<boolean>
}

/**
 * ScopeResolver — decides whether the local owner can SEE a scope at all.
 *
 * The multi-tenant membership graph (org/team/outside-collaborator lookups in
 * the Python source) collapses here to a single owner: seeing a scope means
 * the scope exists.
 */
export class ScopeResolver {
  constructor(private readonly existence: ScopeExistence) {}

  async resolve(scope: ScopeRef): Promise<ScopeResolution> {
    switch (scope.scopeType) {
      case "user":
        return scope.scopeId === LOCAL_OWNER_ID
          ? { ok: true, scope }
          : { ok: false, code: "not_found" }
      case "workspace":
        return (await this.existence.workspaceExists(scope.scopeId))
          ? { ok: true, scope }
          : { ok: false, code: "not_found" }
      case "environment":
        return (await this.existence.environmentExists(scope.scopeId))
          ? { ok: true, scope }
          : { ok: false, code: "not_found" }
    }
  }

  /**
   * The gate every workspace-scoped service operation runs before touching a
   * repository. Throws `NotFoundError` for a workspace that does not exist, so
   * the router answers `not_found` rather than letting the write reach SQLite
   * and fail on a foreign key.
   */
  async assertWorkspaceVisible(workspaceId: string): Promise<void> {
    const resolution = await this.resolve({ scopeType: "workspace", scopeId: workspaceId })
    if (!resolution.ok) throw new NotFoundError(`workspace ${workspaceId} not found`)
  }
}
