export interface WorkflowCanvasNodeData {
  label?: string | null;
  config?: Record<string, unknown>;
  executionStatus?: string;
  executionResult?: unknown;
  executionTimestamp?: number;
  parentNodeId?: string;
  branchCount?: number;
  incomingBranchCount?: number;
  incomingBranches?: Array<{
    index: number;
    nodeId: string;
    label: string;
    edgeLabel: string;
  }>;
  invalid?: boolean;
  schemaRefreshWarning?: {
    text: string;
    sourceUrl: string;
    refreshedAt: string;
    endpointFingerprint: string | null;
  };
  extractors?: Record<string, unknown>;
  [key: string]: unknown;
}
