import type { NodeStatus } from "./NodeStatus";
import type { KeyValuePair } from "@shared/types/KeyValuePair";
import type { GrpcCallType } from "./GrpcCallType";

export interface GrpcNodeData {
  label?: string;
  executionStatus?: NodeStatus;
  executionResult?: {
    response?: { status?: string };
    duration?: number;
    error?: string;
  };
  config?: {
    callType?: GrpcCallType;
    target?: string;
    service?: string;
    method?: string;
    metadata?: KeyValuePair[];
    expectedStatus?: string;
  };
  branchCount?: number;
}
