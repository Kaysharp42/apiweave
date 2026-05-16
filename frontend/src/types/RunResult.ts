import type { NodeType } from './NodeType';
import type { NodeStatus } from './NodeStatus';
import type { ApiResponse } from './ApiResponse';
import type { AssertionResult } from './AssertionResult';

export interface RunResult {
  nodeId: string;
  nodeType: NodeType;
  status: NodeStatus;
  startedAt: string;
  completedAt?: string;
  response?: ApiResponse;
  error?: string;
  assertions?: AssertionResult[];
}
