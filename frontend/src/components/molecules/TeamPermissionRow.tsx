import { Trash2 } from 'lucide-react';
import { IconButton } from '../atoms/IconButton';
import { Badge } from '../atoms/Badge';
import type { TeamPermissionGrant } from '../../types';

export interface TeamPermissionRowProps {
  grant: TeamPermissionGrant;
  onRevoke: (grantId: string) => void;
}

export function TeamPermissionRow({ grant, onRevoke }: TeamPermissionRowProps) {
  return (
    <tr className="border-b border-border dark:border-border-dark last:border-0 hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors">
      <td className="px-4 py-2.5">
        <span className="font-mono text-xs text-text-primary dark:text-text-primary-dark">
          {grant.resourceType}
        </span>
      </td>
      <td className="px-4 py-2.5">
        <span className="font-mono text-xs text-text-secondary dark:text-text-secondary-dark truncate max-w-[12rem] block">
          {grant.resourceId}
        </span>
      </td>
      <td className="px-4 py-2.5">
        <div className="flex gap-1 flex-wrap">
          {grant.permissions.map((perm) => (
            <Badge key={perm} variant="info" size="xs">
              {perm}
            </Badge>
          ))}
        </div>
      </td>
      <td className="px-4 py-2.5">
        <IconButton
          tooltip="Revoke permission"
          variant="error"
          onClick={() => onRevoke(grant.grantId)}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </IconButton>
      </td>
    </tr>
  );
}
