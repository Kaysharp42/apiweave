import type { AuthConfig } from "@shared/types/AuthConfig";
import type { KeyValuePair } from "@shared/types/KeyValuePair";
import type { StreamFinishCondition } from "@shared/types/StreamFinishCondition";

export interface NodeModalWebsocketConfig {
  url: string;
  queryParams: KeyValuePair[];
  headers: KeyValuePair[];
  auth?: AuthConfig;
  subprotocols: string[];
  messages: { data: string; type: "text" | "binary"; delayMs?: number }[];
  timeout: number;
  maxMessages: number;
  finishConditions: StreamFinishCondition[];
  sslVerify: boolean;
  continueOnFail: boolean;
  extractors: Record<string, string>;
}
