import type { JsonValue } from "@shared/types/JsonValue";

export interface ImportedItem {
  label: string;
  url: string;
  method: string;
  headers: string;
  body: string;
  queryParams: string;
  pathVariables: string;
  cookies: string;
  timeout: number;
  openapiMeta: unknown;
  /** OpenAPI import: the response body schema per status, checked when the request runs. */
  responseSchemas?: Record<string, JsonValue> | undefined;
}
