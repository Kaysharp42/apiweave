/** What a dry run of a cURL import reports: the workflow it would create. */
export interface CurlImportPreview {
  stats: {
    totalRequests: number;
  };
  workflow: {
    name: string;
    nodeCount: number;
    edgeCount: number;
  };
}
