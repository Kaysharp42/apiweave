import type { HttpMethod } from "@shared/types/HttpMethod";
import type { KeyValue } from "./KeyValue";
import type { VariableExtractor } from "./VariableExtractor";

export interface HttpRequestConfig {
  method: HttpMethod;
  url: string;
  headers: KeyValue[];
  queryParams: KeyValue[];
  body?: string;
  bodyType?: "json" | "form-data" | "raw" | "none";
  timeout?: number;
  extractors?: VariableExtractor[];
  followRedirects?: boolean;
}
