import type { MergeNodeData } from './MergeNodeData';

export type { BranchInfo } from './BranchInfo';
export type { MergeResult } from './MergeResult';
export type { MergeNodeData } from './MergeNodeData';

export interface MergeNodeProps {
  id: string;
  data: MergeNodeData;
  selected?: boolean;
}
