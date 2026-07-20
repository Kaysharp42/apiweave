import type { SecretScopeType } from "./SecretScopeType";

export interface ScopeBadgeProps {
  scopeType: SecretScopeType | string;
  className?: string;
}
