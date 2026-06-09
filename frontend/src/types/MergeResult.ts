import type { BranchInfo } from './BranchInfo';

export interface MergeResult {
  mergeStrategy?: string;
  branchCount?: number;
  warning?: string;
  branches?: BranchInfo[];
  mergedAt?: string;
}
