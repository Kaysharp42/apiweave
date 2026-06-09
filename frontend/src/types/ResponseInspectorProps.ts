import type { ApiResponse } from './ApiResponse';
import type { NodeResultMetadata } from './NodeResultMetadata';

export interface ResponseInspectorProps {
  response: ApiResponse | null;
  metadata?: NodeResultMetadata;
  rawBody?: string;
}
