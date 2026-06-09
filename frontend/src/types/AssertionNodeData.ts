import type { NodeStatus } from './NodeStatus';
import type { AssertionItem } from './AssertionItem';
import type { AssertionStats } from './AssertionStats';

export interface AssertionNodeData {
  label?: string;
  executionStatus?: NodeStatus;
  config?: {
    assertions?: AssertionItem[];
  };
  assertionStats?: AssertionStats;
  invalid?: boolean;
}
