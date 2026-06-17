import { User, Building2, Layers, Star } from 'lucide-react';
import { Badge } from '../atoms/Badge';
import type { EnvironmentScopeBadgeProps, EnvironmentScopeType } from '../../types';

const SCOPE_CONFIG: Record<
  EnvironmentScopeType,
  { label: string; icon: typeof User; variant: 'primary' | 'info' | 'success' }
> = {
  user: { label: 'User', icon: User, variant: 'info' },
  organization: { label: 'Org', icon: Building2, variant: 'primary' },
  workspace: { label: 'Workspace', icon: Layers, variant: 'success' },
};

export function EnvironmentScopeBadge({
  scopeType,
  isDefault = false,
  size = 'sm',
  className = '',
  showIcon = true,
}: EnvironmentScopeBadgeProps) {
  const config = SCOPE_CONFIG[scopeType];
  if (!config) return null;

  const { label, icon: Icon, variant } = config;

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <Badge variant={variant} size={size}>
        {showIcon && <Icon className="w-3 h-3" aria-hidden="true" />}
        {label}
      </Badge>
      {isDefault && (
        <Badge variant="warning" size={size}>
          <Star className="w-3 h-3" aria-hidden="true" />
          Default
        </Badge>
      )}
    </span>
  );
}
