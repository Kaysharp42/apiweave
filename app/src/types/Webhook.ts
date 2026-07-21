export interface Webhook {
  webhookId: string;
  resourceType: "workflow" | "collection";
  resourceId: string;
  environmentId?: string;
  description?: string;
  enabled: boolean;
  url: string;
  usageCount: number;
  lastUsed?: string;
  lastStatus?: "success" | "failed" | "pending";
}
