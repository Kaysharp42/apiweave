import type { AuthConfig } from "@shared/types/AuthConfig";
import type { KeyValuePair } from "@shared/types/KeyValuePair";

export interface NodeModalGrpcConfig {
  callType: "unary";
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
  extractors: Record<string, string>;
}
