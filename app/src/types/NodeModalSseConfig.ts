import type { AuthConfig } from "@shared/types/AuthConfig";
import type { KeyValuePair } from "@shared/types/KeyValuePair";
import type { StreamFinishCondition } from "@shared/types/StreamFinishCondition";

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
  finishConditions: StreamFinishCondition[];
  continueOnFail: boolean;
  extractors: Record<string, string>;
}
