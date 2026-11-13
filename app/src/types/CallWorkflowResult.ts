export interface CallWorkflowResult {
  message?: string;
  subWorkflow?: {
    workflowId: string;
    runId?: string;
    status: "passed" | "failed" | "cancelled";
    nodeCount: number;
    failedNodeCount: number;
    outputVariableNames: string[];
    forEach?: {
      itemCount: number;
      ranCount: number;
      failedCount: number;
      iterations: Array<{
        index: number;
        runId?: string;
        status: "passed" | "failed" | "cancelled";
      }>;
    };
  };
}
