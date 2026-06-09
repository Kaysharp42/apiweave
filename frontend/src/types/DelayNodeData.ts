import type { NodeStatus } from './NodeStatus';

export interface DelayNodeData {
  label?: string;
  executionStatus?: NodeStatus;
  config?: {
    duration?: number;
  };
}
