import type { HttpMethod } from "./HttpMethod";
import type { KeyValue } from "./KeyValue";

export interface HARImportResult {
  requests: Array<{
    method: HttpMethod;
    url: string;
    headers: KeyValue[];
    body?: string;
  }>;
}
