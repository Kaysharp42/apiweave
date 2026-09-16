export interface CallWorkflowResult {
  message?: string;
  subWorkflow?: {
    workflowId: string;
    runId?: string;
    status: "passed" | "failed";
    nodeCount: number;
    failedNodeCount: number;
    outputVariableNames: string[];
  };
}
