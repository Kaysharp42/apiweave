import type { EnvironmentScopeType } from "./EnvironmentScopeType";

export type { EnvironmentScopeType } from "./EnvironmentScopeType";

/**
 * Scoped environment — replaces the legacy Environment type.
 * Each environment belongs to a user or workspace scope.
 * Each workspace has exactly one default environment (isDefault=true).
 */
export interface ScopedEnvironment {
  environmentId: string;
  name: string;
  description?: string;
  swaggerDocUrl?: string;
  variables: Record<string, string>;
  secrets?: Record<string, string>;
  scopeType: EnvironmentScopeType;
  scopeId: string;
  ownerType?: string;
  isDefault: boolean;
  allowedWorkspaceIds: string[];
  createdAt: string;
  updatedAt: string;
}
