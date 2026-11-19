export interface CallWorkflowResult {
  /** The failure verdict when the called workflow failed — see the executor's `subWorkflowFailureMessage`. */
  error?: string;
  /** Informational outcome text (a completed or cancelled call); failures speak through `error`. */
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
