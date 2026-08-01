export interface WorkflowCallNodeConfig {
  targetWorkflowId?: string | null;
  /** Denormalized display name, refreshed whenever the picker sets a new target. Read-only on the canvas. */
  targetWorkflowName?: string | null;
  inputMapping?: Record<string, string>;
  outputMapping?: Record<string, string>;
}
