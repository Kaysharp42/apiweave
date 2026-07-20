import type { ApprovalActorType } from "./ApprovalActorType";
import type { ApprovalStatus } from "./ApprovalStatus";

export type { ApprovalActorType } from "./ApprovalActorType";
export type { ApprovalStatus } from "./ApprovalStatus";

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
