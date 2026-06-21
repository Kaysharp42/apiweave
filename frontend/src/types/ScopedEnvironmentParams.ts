import type { EnvironmentScopeType } from "./ScopedEnvironment";

/**
 * ScopedEnvironmentParams — parameters for fetching environments at a given scope.
 */
export interface ScopedEnvironmentParams {
  /** The scope type (user, organization, or workspace). */
  scopeType: EnvironmentScopeType;
  /** The ID of the scope owner. */
  scopeId: string;
}
