/**
 * Extended secret metadata for single-secret views.
 *
 * Includes the same fields as Secret plus optional override information
 * for environment-scoped secrets that shadow a parent scope.
 */
export interface SecretMetadata {
  secretId: string;
  name: string;
  scopeType: string;
  scopeId: string;
  keyId: string;
  createdAt: string;
  updatedAt: string;
  /** True when this secret overrides a same-named secret at a broader scope. */
  isOverride?: boolean;
  /** The broader scope type that this secret overrides, if any. */
  overriddenScopeType?: string;
}
