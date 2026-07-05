import type { Action, Resource } from "./permissions"
import type { PermissionDecision, PermissionProvider, ScopeRef } from "./PermissionProvider"

/**
 * LocalOwnerProvider — the always-allow adapter for single-user desktop mode.
 *
 * Every service authorizes through `PermissionProvider.evaluate(...)`. In the
 * desktop app there is exactly one synthetic local owner who can do anything
 * inside any scope they can see. Existence-hiding (the `not_found` contract
 * for unknown scopes) lives in `scope_resolver.ts`, NOT here — this provider
 * is reached only for scopes the resolver already confirmed the caller can see,
 * so it always returns `allow`.
 *
 * A future cloud provider replaces this seam with role/team-grant evaluation
 * against the same `permissions.ts` vocabulary, no service-side branching.
 */
export class LocalOwnerProvider implements PermissionProvider {
  public evaluate(_action: Action, _scope: ScopeRef, _resource: Resource): PermissionDecision {
    return { decision: "allow" }
  }
}
