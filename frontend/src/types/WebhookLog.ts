export interface WebhookLog {
  logId: string;
  status: "success" | "failed" | "pending";
  timestamp?: string;
  duration?: number;
  errorMessage?: string;
  runId?: string;
}
