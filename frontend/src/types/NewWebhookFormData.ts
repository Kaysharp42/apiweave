export interface NewWebhookFormData {
  resourceType: "workflow" | "collection";
  resourceId: string;
  environmentId: string;
  description: string;
}
