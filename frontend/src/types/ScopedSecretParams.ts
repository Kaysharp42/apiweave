import type { SecretScopeType } from './Secret';

/**
 * ScopedSecretParams — parameters for fetching secrets at a given scope.
 */
export interface ScopedSecretParams {
  /** The scope type (user, organization, workspace, or environment). */
  scopeType: SecretScopeType;
  /** The ID of the scope owner. */
  scopeId: string;
}
