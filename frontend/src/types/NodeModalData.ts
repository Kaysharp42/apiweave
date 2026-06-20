export interface NodeModalData {
  label: string;
  config: Record<string, unknown>;
  executionResult?: unknown;
  executionStatus?: string | undefined;
}
