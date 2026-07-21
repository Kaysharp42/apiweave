import type { Resource, Action } from "./permissions"

/**
 * Result of a permission evaluation. The cloud/teams layer will introduce a
 * `denied` decision with a reason; locally (LocalOwnerProvider) the seam
 * always returns `allow` for any known scope and `not_found` for any unknown
 * scope — the existence-hiding contract lives in `scope_resolver.ts`, not here.
 */
export type PermissionDecision =
  | { readonly decision: "allow" }
  | { readonly decision: "denied"; readonly reason: string }

/**
 * PermissionProvider — the seam every service authorizes through.
 *
 * Local mode: implemented by `LocalOwnerProvider` (always-allow).
 * Cloud/teams mode: a future provider evaluates roles, team grants, outside
 * collaborator perms, and service-token scopes against the same permission
 * vocabulary — see `permissions.ts` for the resource/action strings.
 *
 * Services call `evaluate(action, scope, resource)` AFTER `scopeResolver.resolve(scope)`
 * has confirmed the caller can SEE the scope. A `denied` decision here is the
 * explicit "you can see it but can't touch it" path — rare in single-user mode
 * but the contract every caller defends.
 */
export interface PermissionProvider {
  evaluate(action: Action, scope: ScopeRef, resource: Resource): PermissionDecision
}

/**
 * Scope reference — what the service is operating on. The `scopeType` +
 * `scopeId` pair mirrors the Python `scope_resolver.py` contract; the cloud
 * provider will join membership tables on these.
 */
export interface ScopeRef {
  readonly scopeType: "user" | "workspace" | "environment"
  readonly scopeId: string
}
