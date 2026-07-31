export interface NodeModalWorkflowCallConfig {
  targetWorkflowId: string | null;
  targetWorkflowName: string | null;
  inputMapping: Record<string, string>;
  outputMapping: Record<string, string>;
}
