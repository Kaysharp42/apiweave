import type { AuditActorType } from "./AuditActorType";
import type { AuditScopeType } from "./AuditScopeType";

export type { AuditActorType } from "./AuditActorType";
export type { AuditScopeType } from "./AuditScopeType";

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
