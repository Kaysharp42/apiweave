export type AuditActorType =
  | "user"
  | "org_app"
  | "service_token"
  | "mcp_client"
  | "webhook_token"
  | "system_migration";

export type AuditScopeType = "org" | "workspace" | "environment";

export interface AuditEvent {
  eventId: string;
  actor: AuditActorType;
  actorId: string;
  action: string;
  scope: AuditScopeType;
  scopeId: string;
  resourceType: string;
  resourceId: string;
  context: Record<string, string>;
  createdAt: string;
}
