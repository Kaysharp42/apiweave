import { CheckCircle2, XCircle, Clock, User, Bot, Globe, Cpu } from 'lucide-react';
import { Button } from '../atoms/Button';
import { Badge } from '../atoms/Badge';
import { EmptyState } from '../molecules/EmptyState';
import type { PendingApprovalsListProps, ApprovalActorType } from '../../types';

const ACTOR_ICONS: Record<ApprovalActorType, typeof User> = {
  user: User,
  service_token: Bot,
  webhook: Globe,
  system: Cpu,
};

export function PendingApprovalsList({
  approvals,
  onApprove,
  onDeny,
  loading = false,
  currentUserId,
  requiredReviewerIds = [],
  className = '',
}: PendingApprovalsListProps) {
  const pendingApprovals = approvals.filter((a) => a.status === 'pending');

  if (pendingApprovals.length === 0) {
    return (
      <EmptyState
        title="No pending approvals"
        description="All runs have been reviewed."
        icon={<CheckCircle2 className="w-12 h-12 text-status-success" strokeWidth={1.5} />}
        className={className}
      />
    );
  }

  const canUserApprove = (currentUserId: string | undefined, reviewerIds: string[]): boolean => {
    if (!currentUserId) return false;
    return reviewerIds.includes(currentUserId);
  };

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex items-center gap-2">
        <Clock className="w-4 h-4 text-status-warning" />
        <h3 className="text-sm font-semibold text-text-primary dark:text-text-primary-dark">
          Pending Approvals ({pendingApprovals.length})
        </h3>
      </div>

      {pendingApprovals.map((approval) => {
        const ActorIcon = ACTOR_ICONS[approval.requestedByActorType] ?? User;
        const userCanApprove = canUserApprove(currentUserId, requiredReviewerIds);

        return (
          <div
            key={approval.approvalId}
            className="flex items-start gap-3 p-3 rounded border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised"
          >
            <div className="flex-shrink-0 mt-0.5">
              <div className="w-8 h-8 rounded-full bg-status-warning/10 dark:bg-status-warning/20 flex items-center justify-center">
                <ActorIcon className="w-4 h-4 text-status-warning" />
              </div>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-medium text-text-primary dark:text-text-primary-dark truncate">
                  Run {approval.runId.slice(0, 8)}...
                </span>
                <Badge variant="warning" size="xs">
                  Pending
                </Badge>
              </div>
              <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
                Requested by{' '}
                <span className="font-medium">{approval.requestedByActorId.slice(0, 12)}...</span>
                {' '}via {approval.requestedByActorType}
              </p>
              <p className="text-xs text-text-muted dark:text-text-muted-dark mt-0.5">
                {new Date(approval.createdAt).toLocaleString()}
              </p>
            </div>

            <div className="flex items-center gap-1.5 flex-shrink-0">
              <Button
                variant="primary"
                intent="success"
                size="xs"
                icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                onClick={() => onApprove(approval.approvalId)}
                disabled={!userCanApprove || loading}
              >
                Approve
              </Button>
              <Button
                variant="ghost"
                intent="error"
                size="xs"
                icon={<XCircle className="w-3.5 h-3.5" />}
                onClick={() => onDeny(approval.approvalId)}
                disabled={!userCanApprove || loading}
              >
                Deny
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
