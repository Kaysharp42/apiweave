import type { AuthConfig } from "@shared/types/AuthConfig";
import type { KeyValuePair } from "@shared/types/KeyValuePair";
import type { SseFinishCondition } from "@shared/types/SseFinishCondition";

export interface NodeModalSseConfig {
  url: string;
  queryParams: KeyValuePair[];
  headers: KeyValuePair[];
  auth?: AuthConfig;
  timeout: number;
  followRedirects: boolean;
  sslVerify: boolean;
  eventType?: string;
  maxEvents: number;
  finishConditions: SseFinishCondition[];
  continueOnFail: boolean;
  extractors: Record<string, string>;
}
