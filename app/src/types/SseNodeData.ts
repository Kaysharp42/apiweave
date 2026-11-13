import type { NodeStatus } from "./NodeStatus";
import type { KeyValuePair } from "@shared/types/KeyValuePair";
import type { StreamFinishCondition } from "@shared/types/StreamFinishCondition";

export interface SseNodeData {
  label?: string;
  executionStatus?: NodeStatus;
  executionResult?: {
    body?: { eventCount?: number };
    duration?: number;
    error?: string;
  };
  config?: {
    url?: string;
    eventType?: string;
    maxEvents?: number;
    timeout?: number;
    headers?: KeyValuePair[];
    finishConditions?: StreamFinishCondition[];
  };
  branchCount?: number;
}
