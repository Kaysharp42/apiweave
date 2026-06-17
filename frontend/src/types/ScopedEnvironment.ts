/** Scope types for scoped environments. */
export type EnvironmentScopeType = 'user' | 'organization' | 'workspace';

/**
 * Scoped environment — replaces the legacy Environment type.
 * Each environment belongs to a user, organization, or workspace scope.
 * Organization environments can restrict access via allowedWorkspaceIds.
 * Each workspace has exactly one default environment (isDefault=true).
 */
export interface ScopedEnvironment {
  environmentId: string;
  name: string;
  description?: string;
  swaggerDocUrl?: string;
  variables: Record<string, unknown>;
  scopeType: EnvironmentScopeType;
  scopeId: string;
  ownerType?: string;
  isDefault: boolean;
  allowedWorkspaceIds: string[];
  createdAt: string;
  updatedAt: string;
}
