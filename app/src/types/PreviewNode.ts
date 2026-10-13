import type { JsonValue } from "@shared/types/JsonValue";

export interface PreviewNode {
  type?: string;
  label?: string;
  config?: {
    method?: string;
    url?: string;
    headers?: string;
    cookies?: string;
    queryParams?: string;
    pathVariables?: string;
    body?: string;
    timeout?: number;
    responseSchemas?: Record<string, JsonValue>;
  };
}
