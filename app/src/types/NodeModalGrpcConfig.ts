import type { AuthConfig } from "@shared/types/AuthConfig";
import type { KeyValuePair } from "@shared/types/KeyValuePair";
import type { StreamFinishCondition } from "@shared/types/StreamFinishCondition";

export interface NodeModalGrpcConfig {
  callType: "unary" | "server-streaming";
  target: string;
  tls: boolean;
  sslVerify: boolean;
  service: string;
  method: string;
  message: string;
  metadata: KeyValuePair[];
  auth?: AuthConfig;
  deadline: number;
  schemaSource: "reflection" | "proto";
  /** Inline .proto files, path to content. */
  protoFiles: Record<string, string>;
  continueOnFail: boolean;
  expectedStatus?: string;
  maxMessages: number;
  finishConditions: StreamFinishCondition[];
  extractors: Record<string, string>;
}
