import type { AssertionNodeData } from './AssertionNodeData';

export type { AssertionItem } from './AssertionItem';
export type { AssertionStats } from './AssertionStats';
export type { AssertionNodeData } from './AssertionNodeData';

export interface AssertionNodeProps {
  id: string;
  data: AssertionNodeData;
  selected?: boolean;
}
