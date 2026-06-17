import type { PendingApproval } from './PendingApproval';

export interface PendingApprovalsListProps {
  /** Pending approvals to display. */
  approvals: PendingApproval[];
  /** Called when a reviewer approves a pending run. */
  onApprove: (approvalId: string) => void | Promise<void>;
  /** Called when a reviewer denies a pending run. */
  onDeny: (approvalId: string) => void | Promise<void>;
  /** Whether an action is in progress. */
  loading?: boolean;
  /** The current user's ID (to check if they can approve). */
  currentUserId?: string;
  /** IDs of required reviewers for the environment. */
  requiredReviewerIds?: string[] | undefined;
  className?: string;
}
