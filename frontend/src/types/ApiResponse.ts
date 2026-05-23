import type { NodeResultMetadata } from './NodeResultMetadata';
import type { ResponseCookie } from './ResponseCookie';

export interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  responseTime: number;
  cookies?: ResponseCookie[];
  metadata?: NodeResultMetadata;
}
