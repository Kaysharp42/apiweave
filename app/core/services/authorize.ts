import type { Action, Resource } from "../auth/permissions"
import type { PermissionProvider, ScopeRef } from "../auth/PermissionProvider"
import type { ScopeResolver } from "./scope_resolver"
import { DeniedError, NotFoundError } from "../ipc/errors"

/**
 * The two-step gate every service operation runs before touching a repository,
 * collapsing Python's `scope_resolver.resolve` + permission check into one call:
 *
 *  1. `scopeResolver.resolve(scope)` — can the caller SEE the scope? A scope that
 *     doesn't exist returns `not_found`, NEVER `denied` (existence-hiding, ported
 *     from `backend/app/services/scope_resolver.py`).
 *  2. `permissionProvider.evaluate(...)` — may the caller perform `action`? Local
 *     mode (`LocalOwnerProvider`) always allows; the cloud/teams provider slots in
 *     here without touching a single service.
 *
 * Returns the resolved `ScopeRef` so callers that need it (e.g. sync hooks) don't
 * re-resolve. Throws `NotFoundError` / `DeniedError` — the router maps both to the
 * contract envelope.
 */
export async function authorizeWorkspace(
  scopeResolver: ScopeResolver,
  permissionProvider: PermissionProvider,
  workspaceId: string,
  action: Action,
  resource: Resource,
): Promise<ScopeRef> {
  const resolution = await scopeResolver.resolve({ scopeType: "workspace", scopeId: workspaceId })
  if (!resolution.ok) {
    throw new NotFoundError(`workspace ${workspaceId} not found`)
  }
  const decision = permissionProvider.evaluate(action, resolution.scope, resource)
  if (decision.decision === "denied") {
    throw new DeniedError(decision.reason)
  }
  return resolution.scope
}
