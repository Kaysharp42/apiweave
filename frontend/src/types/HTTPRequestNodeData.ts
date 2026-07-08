import type { NodeStatus } from "./NodeStatus";
import type { HttpMethod } from "./HttpMethod";
import type { FileUpload } from "./FileUpload";
import type { KeyValuePair } from "./KeyValuePair";
import type { SchemaWarning } from "./SchemaWarning";

export interface HTTPRequestNodeData {
  label?: string;
  executionStatus?: NodeStatus;
  executionResult?: {
    body?: string | Record<string, unknown>;
    statusCode?: number;
    duration?: number;
    responseTimeMs?: number;
    responseSizeBytes?: number;
    contentType?: string;
    bodyFormat?: string;
    cookies?: Record<string, string>;
    error?: string;
  };
  config?: {
    method?: HttpMethod;
    url?: string;
    queryParams?: string | KeyValuePair[];
    pathVariables?: string | KeyValuePair[];
    headers?: string | KeyValuePair[];
    cookies?: string | KeyValuePair[];
    body?: string;
    bodyType?: "json" | "form-data" | "raw" | "none";
    timeout?: number;
    extractors?: Record<string, string>;
    fileUploads?: FileUpload[];
  };
  schemaRefreshWarning?: SchemaWarning;
  branchCount?: number;
}
