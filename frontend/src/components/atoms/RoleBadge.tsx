import { Badge } from './Badge';
import type { OrgRole } from '../../types';

export interface RoleBadgeProps {
  role: OrgRole | string;
  className?: string;
}

const ROLE_VARIANT: Record<string, 'primary' | 'success' | 'warning' | 'info' | 'default'> = {
  owner: 'warning',
  member: 'primary',
  billing: 'info',
  security: 'success',
};

export function RoleBadge({ role, className = '' }: RoleBadgeProps) {
  const variant = ROLE_VARIANT[role] ?? 'default';
  return (
    <Badge variant={variant} size="sm" className={className}>
      {role}
    </Badge>
  );
}
