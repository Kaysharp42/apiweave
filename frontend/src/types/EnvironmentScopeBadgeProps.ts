import type { EnvironmentScopeType } from './ScopedEnvironment';

export interface EnvironmentScopeBadgeProps {
  scopeType: EnvironmentScopeType;
  isDefault?: boolean;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  showIcon?: boolean;
}
