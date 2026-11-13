import type { NodeStatus } from "./NodeStatus";
import type { KeyValuePair } from "@shared/types/KeyValuePair";
import type { StreamFinishCondition } from "@shared/types/StreamFinishCondition";

export interface WebsocketNodeData {
  label?: string;
  executionStatus?: NodeStatus;
  executionResult?: {
    body?: { messageCount?: number };
    duration?: number;
    error?: string;
  };
  config?: {
    url?: string;
    maxMessages?: number;
    timeout?: number;
    headers?: KeyValuePair[];
    subprotocols?: string[];
    messages?: { data: string; type?: "text" | "binary"; delayMs?: number }[];
    finishConditions?: StreamFinishCondition[];
  };
  branchCount?: number;
}
