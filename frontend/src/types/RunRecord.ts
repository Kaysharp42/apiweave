export interface RunRecord {
  runId: string;
  status: string;
  createdAt: string;
  duration?: number;
  trigger?: string;
  error?: string;
  failedNodes?: string[];
}
