import type { HttpMethod } from "@shared/types/HttpMethod";
import type { KeyValue } from "./KeyValue";

export interface CurlImportResult {
  method: HttpMethod;
  url: string;
  headers: KeyValue[];
  body?: string;
}
