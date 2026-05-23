import type { NodeStatus } from './NodeStatus';

export interface NodeData {
  label: string;
  status?: NodeStatus;
  config: Record<string, unknown>;
  outputs?: Record<string, unknown>;
}
