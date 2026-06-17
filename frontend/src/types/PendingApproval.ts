/** Status of a pending approval record. */
export type ApprovalStatus = 'pending' | 'approved' | 'bypassed' | 'rejected';

/** Actor type that requested or resolved an approval. */
export type ApprovalActorType = 'user' | 'service_token' | 'webhook' | 'system';

/**
 * Pending approval record for a protected environment run.
 */
export interface PendingApproval {
  approvalId: string;
  runId: string;
  environmentId: string;
  workspaceId: string;
  requestedByUserId?: string;
  requestedByActorType: ApprovalActorType;
  requestedByActorId: string;
  status: ApprovalStatus;
  resolvedBy?: string;
  resolvedByActorType?: ApprovalActorType;
  bypassReason?: string;
  createdAt: string;
  resolvedAt?: string;
}
