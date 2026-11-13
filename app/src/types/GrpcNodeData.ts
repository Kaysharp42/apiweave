import type { NodeStatus } from "./NodeStatus";
import type { KeyValuePair } from "@shared/types/KeyValuePair";

export interface GrpcNodeData {
  label?: string;
  executionStatus?: NodeStatus;
  executionResult?: {
    response?: { status?: string };
    duration?: number;
    error?: string;
  };
  config?: {
    target?: string;
    service?: string;
    method?: string;
    metadata?: KeyValuePair[];
    expectedStatus?: string;
  };
  branchCount?: number;
}
