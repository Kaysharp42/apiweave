import type { HttpMethod } from './HttpMethod';
import type { KeyValue } from './KeyValue';

export interface CurlImportResult {
  method: HttpMethod;
  url: string;
  headers: KeyValue[];
  body?: string;
}
