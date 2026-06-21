export interface WebhookRun {
  id: string;
  runId: string;
  status: "pending" | "running" | "success" | "failed";
  triggeredAt: string;
  duration: number;
}
