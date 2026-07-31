export interface CallWorkflowResult {
  message?: string;
  subWorkflow?: {
    workflowId: string;
    status: "passed" | "failed";
    nodeCount: number;
    failedNodeCount: number;
    outputVariableNames: string[];
  };
}
