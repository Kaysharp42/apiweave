export interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  responseTime: number;
}
