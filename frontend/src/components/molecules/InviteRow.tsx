import { Trash2, RefreshCw } from 'lucide-react';
import { IconButton } from '../atoms/IconButton';
import { StatusBadge } from './StatusBadge';
import type { OrgInvite } from '../../types';

export interface InviteRowProps {
  invite: OrgInvite;
  onResend: (inviteId: string) => void;
  onCancel: (inviteId: string) => void;
  resending?: boolean;
}

export function InviteRow({ invite, onResend, onCancel, resending = false }: InviteRowProps) {
  const isExpired = new Date(invite.expires_at) < new Date();
  const isConsumed = invite.consumed;

  return (
    <tr className="border-b border-border dark:border-border-dark last:border-0 hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors">
      <td className="px-6 py-3">
        <span className="font-medium text-text-primary dark:text-text-primary-dark">
          {invite.email}
        </span>
      </td>
      <td className="px-6 py-3">
        <span className="px-2 py-0.5 bg-primary/10 text-primary dark:text-primary-light rounded-full text-xs font-medium">
          {invite.role}
        </span>
      </td>
      <td className="px-6 py-3">
        {isConsumed ? (
          <StatusBadge status="success" label="Accepted" size="xs" />
        ) : isExpired ? (
          <StatusBadge status="error" label="Expired" size="xs" />
        ) : (
          <StatusBadge status="warning" label="Pending" size="xs" />
        )}
      </td>
      <td className="px-6 py-3 text-xs text-text-secondary dark:text-text-secondary-dark">
        {new Date(invite.expires_at).toLocaleDateString()}
      </td>
      <td className="px-6 py-3">
        <div className="flex items-center gap-1">
          {!isConsumed && !isExpired && (
            <IconButton
              tooltip="Resend invite"
              onClick={() => onResend(invite.inviteId)}
              disabled={resending}
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </IconButton>
          )}
          <IconButton
            tooltip="Cancel invite"
            variant="error"
            onClick={() => onCancel(invite.inviteId)}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </IconButton>
        </div>
      </td>
    </tr>
  );
}
