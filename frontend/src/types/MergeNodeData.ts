import type { NodeStatus } from "./NodeStatus";
import type { BranchInfo } from "./BranchInfo";
import type { MergeResult } from "./MergeResult";

export interface MergeNodeData {
  label?: string;
  config?: {
    mergeStrategy?: string;
  };
  executionStatus?: NodeStatus;
  executionResult?: MergeResult;
  status?: NodeStatus;
  result?: MergeResult;
  incomingBranchCount?: number;
  incomingBranches?: BranchInfo[];
}
